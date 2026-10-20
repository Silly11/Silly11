"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Eye,
  Globe2,
  Heart,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  Moon,
  Orbit,
  Plus,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Users,
  X,
} from "lucide-react";
import UniverseScene from "./universe-scene";
import { DEFAULT_PLANET_ID, PLANETS, type PlanetId } from "@/lib/planets";
import type {
  ActionName,
  AppState,
  ChatMessage,
  Entry,
  Mood,
} from "@/lib/types";

type Tab =
  | "personal"
  | "public"
  | "groups"
  | "letters"
  | "chat"
  | "settings"
  | "support";
const MOODS = {
  joy: {
    label: "Niềm vui",
    description: "Những điều khiến bạn mỉm cười",
    color: "#f1cc80",
  },
  sadness: {
    label: "Nỗi buồn",
    description: "Để lòng mình được nhẹ hơn",
    color: "#97a9ff",
  },
  unsaid: {
    label: "Lời gửi gió",
    description: "Gửi nhẹ những điều còn trong lòng",
    color: "#d09bcf",
  },
};
const NAV = [
  { id: "personal", label: "Thiên hà của bạn", icon: Orbit },
  { id: "public", label: "Thiên hà chung", icon: Globe2 },
  { id: "groups", label: "Vòng tròn kết nối", icon: Users },
  { id: "letters", label: "Thư gửi tương lai", icon: Send },
  { id: "chat", label: "Một người lắng nghe", icon: MessageCircle },
] as const;
const EMPTY: AppState = {
  user: null,
  entries: [],
  letters: [],
  chat: {
    messages: [],
    remaining: 5,
    cooldownUntil: null,
    status: "ai",
    ticketId: null,
  },
  notifications: [],
  groups: [],
  requests: [],
  staffQueue: [],
  config: {
    aiEnabled: false,
    billingEnabled: false,
    oauthProviders: [],
    backupRetentionDays: 30,
  },
};
const date = (value: string) =>
  new Date(value).toLocaleDateString("vi-VN", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

export default function CosmicApp() {
  const [state, setState] = useState<AppState>(EMPTY);
  const [launch, setLaunch] = useState<{
    sequence: number;
    public: boolean;
    planetId: PlanetId;
  } | null>(null);
  const [guestEntries, setGuestEntries] = useState<Entry[]>([]);
  const [tab, setTab] = useState<Tab>("personal");
  const [personalPlanetId, setPersonalPlanetId] = useState<PlanetId | "">("");
  const [publicPlanetId, setPublicPlanetId] = useState<PlanetId | "">("");
  const selectedPlanetId = tab === "public" ? publicPlanetId : personalPlanetId;
  const selectPlanet =
    tab === "public" ? setPublicPlanetId : setPersonalPlanetId;
  const [modal, setModal] = useState<
    "compose" | "auth" | "premium" | "notices" | "letter" | null
  >(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [mood, setMood] = useState<Mood>("joy");
  const [filter, setFilter] = useState<Mood | "all">("all");
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [menu, setMenu] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [chatText, setChatText] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [composeGroup, setComposeGroup] = useState("");
  const [peer, setPeer] = useState<{
    id: string;
    messages: {
      id: string;
      kind: "self" | "peer";
      content: string;
      createdAt: string;
    }[];
  } | null>(null);
  const [support, setSupport] = useState<{
    messages: ChatMessage[];
    entries: Entry[];
  } | null>(null);
  const premium =
    !!state.user?.premiumUntil &&
    new Date(state.user.premiumUntil) > new Date();
  const allEntries = state.user
    ? state.entries
    : [...guestEntries, ...state.entries.filter((e) => !e.owned)];
  const mine = allEntries.filter((e) => e.owned);
  const visibleEntries = allEntries.filter(
    (e) =>
      (tab === "public" ? e.visibility === "public" : e.owned) &&
      !!selectedPlanetId &&
      e.planetId === selectedPlanetId &&
      (filter === "all" || e.mood === filter) &&
      `${e.content} ${e.displayName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );

  async function refresh() {
    try {
      const response = await fetch("/api/state");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Không thể tải dữ liệu.");
      setState(data);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Không thể kết nối.");
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (peer?.id) void readPeer(peer.id);
      if (ticketId && tab === "support") void readTicket(ticketId);
      if (state.user && tab === "groups") void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [peer?.id, ticketId, tab, state.user?.id]);
  useEffect(() => {
    if (!launch) return;
    const timer = setTimeout(() => setLaunch(null), 2200);
    return () => clearTimeout(timer);
  }, [launch]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (state.user && (tab === "chat" || tab === "support")) void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [state.user, tab]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setModal(null);
        setEntry(null);
        setPeer(null);
        setMenu(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function request(url: string, payload: unknown) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Có lỗi xảy ra, bạn hãy thử lại.");
    return data;
  }
  async function act(
    action: ActionName,
    payload: Record<string, unknown> = {},
  ) {
    setBusy(true);
    try {
      const data = await request("/api/action", { action, payload });
      setState(data);
      return true;
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Không thể thực hiện.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  function needsAccount(callback: () => void) {
    if (!state.user) setModal("auth");
    else callback();
  }
  function compose(selectedMood?: Mood) {
    setComposeGroup("");
    if (selectedMood) setMood(selectedMood);
    setModal("compose");
  }
  function openEntry(value: Entry) {
    setRevealed(!(value.authorPremium || value.mood === "sadness"));
    setEntry(value);
  }
  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const content = String(form.get("content") || "").trim();
    const visibility = String(form.get("visibility") || "private");
    const planetId =
      PLANETS.find((p) => p.id === form.get("planetId"))?.id ??
      DEFAULT_PLANET_ID;
    if (!content) return;
    if (!state.user) {
      if (visibility !== "private") {
        setModal("auth");
        return;
      }
      setGuestEntries((old) => [
        {
          id: crypto.randomUUID(),
          content,
          mood,
          authorId: "guest",
          displayName: "Bạn",
          visibility: "private",
          groupId: null,
          planetId,
          owned: true,
          authorPremium: false,
          supportVisible: false,
          createdAt: new Date().toISOString(),
        },
        ...old,
      ]);
      setModal(null);
      setLaunch((old) => ({
        sequence: (old?.sequence ?? 0) + 1,
        public: false,
        planetId,
      }));
      setTab("personal");
      setPersonalPlanetId(planetId);
      setToast("Một ngôi sao đã được thêm vào phiên trải nghiệm của bạn.");
      return;
    }
    if (
      await act("entry.create", {
        content,
        mood,
        visibility,
        identity: form.get("identity"),
        nickname: form.get("nickname"),
        groupId: form.get("groupId") || undefined,
        planetId,
        supportVisible: form.get("supportVisible") === "on",
      })
    ) {
      setModal(null);
      if (visibility !== "group") {
        setLaunch((old) => ({
          sequence: (old?.sequence ?? 0) + 1,
          public: visibility === "public",
          planetId,
        }));
        setTab(visibility === "public" ? "public" : "personal");
        if (visibility === "public") setPublicPlanetId(planetId);
        else setPersonalPlanetId(planetId);
      }
      setToast("Tâm tư của bạn đã được gửi vào thiên hà.");
    }
  }
  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await request(`/api/auth/${authMode}`, {
        name: form.get("name"),
        email: form.get("email"),
        password: form.get("password"),
      });
      await refresh();
      setGuestEntries([]);
      setModal(null);
      setToast("Chào mừng bạn về với thiên hà của mình.");
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Đăng nhập chưa thành công.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await request("/api/auth/logout", {});
      setGuestEntries([]);
      setPeer(null);
      setSupport(null);
      setTicketId("");
      setEntry(null);
      await refresh();
      setTab("personal");
    } catch {
      setToast("Chưa thể đăng xuất. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  }
  async function billingPortal() {
    setBusy(true);
    try {
      const data = await request("/api/billing/portal", {});
      window.location.assign(data.url);
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Chưa thể mở quản lý gói.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function checkout() {
    if (!state.user) {
      setModal("auth");
      return;
    }
    setBusy(true);
    try {
      const data = await request("/api/billing/checkout", {});
      window.location.assign(data.url);
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Chưa thể mở thanh toán.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function readPeer(id: string) {
    try {
      const response = await fetch(
        `/api/connection?id=${encodeURIComponent(id)}`,
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Không thể mở trò chuyện.");
      setPeer({ id, messages: data.messages });
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Không thể mở trò chuyện.",
      );
    }
  }
  async function verifyEmail() {
    setBusy(true);
    try {
      await request("/api/auth/verify-request", {});
      setToast("Đã yêu cầu gửi thư xác minh. Bạn hãy kiểm tra hộp thư email.");
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Chưa thể gửi thư xác minh.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function readTicket(id: string) {
    try {
      const response = await fetch(`/api/support?id=${encodeURIComponent(id)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setTicketId(id);
      setSupport(data);
    } catch (error) {
      setToast(
        error instanceof Error ? error.message : "Không thể đọc phiên hỗ trợ.",
      );
    }
  }

  return (
    <div className="cosmic-app">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <button
          className="brand"
          onClick={() => {
            setTab("personal");
            setMenu(false);
          }}
          aria-label="COSMIC ECHO trang chủ"
        >
          <span className="brand-mark">
            <Orbit size={30} strokeWidth={1.2} />
          </span>
          <span>
            COSMIC ECHO<small>TIẾNG VỌNG THIÊN HÀ</small>
          </span>
        </button>
        <div className="nav-label">KHÔNG GIAN CỦA BẠN</div>
        <nav>
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${tab === id ? "active" : ""}`}
              onClick={() => {
                setTab(id);
                setFilter("all");
                setSearch("");
                setMenu(false);
              }}
            >
              <Icon size={19} strokeWidth={1.6} />
              <span>{label}</span>
              {id === "letters" && <span className="new-label">MỚI</span>}
            </button>
          ))}
          {state.user && state.user.role !== "user" && (
            <button
              className={`nav-item ${tab === "support" ? "active" : ""}`}
              onClick={() => setTab("support")}
            >
              <ShieldCheck size={19} />
              Không gian hỗ trợ
            </button>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="premium-card">
            <span className="premium-icon">
              <Sparkles size={22} />
            </span>
            <h3>Một chút gần nhau hơn</h3>
            <p>
              Để luôn có một người
              <br />
              lắng nghe tâm tư của bạn.
            </p>
            <button onClick={() => setModal("premium")}>
              {premium ? "Gói Premium của bạn" : "Khám phá Premium"}
              <ArrowUpRight />
            </button>
            <small>10 USD / tháng · Đồng hành cùng bạn</small>
          </div>
          <button
            className={`nav-item ${tab === "settings" ? "active" : ""}`}
            onClick={() => setTab("settings")}
          >
            <Settings2 size={18} />
            Cài đặt & quyền riêng tư
          </button>
          <div className="sidebar-foot">
            <span className="tiny-star">✦</span> Một góc nhỏ, dành riêng cho bạn
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="sidebar-scrim"
          onClick={() => setMenu(false)}
          aria-label="Đóng menu"
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenu(!menu)}
            aria-label="Mở menu"
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            Không gian bình yên <ChevronRight size={13} />
            <span>
              {NAV.find((n) => n.id === tab)?.label ||
                (tab === "support" ? "Hỗ trợ" : "Cài đặt")}
            </span>
          </div>
          <div className="topbar-actions">
            <button
              className="notification-button icon-button"
              aria-label="Thông báo"
              onClick={() => needsAccount(() => setModal("notices"))}
            >
              <Bell size={19} />
              {state.notifications.some((n) => !n.read) && <i />}
            </button>
            <span className="topbar-divider" />
            <button
              className="profile-button"
              onClick={() =>
                state.user ? setTab("settings") : setModal("auth")
              }
            >
              <span className="avatar">
                {state.user ? (
                  state.user.name[0].toUpperCase()
                ) : (
                  <Moon size={17} />
                )}
              </span>
              <span>
                {state.user?.name || "Người ghé thăm"}
                <small>
                  {premium
                    ? "Thành viên Premium"
                    : state.user
                      ? "Thiên hà riêng của bạn"
                      : "Đăng nhập để lưu tâm tư"}
                </small>
              </span>
              <ChevronRight size={14} />
            </button>
          </div>
        </header>
        <main>
          {(tab === "personal" || tab === "public") && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span /> CHẬM LẠI MỘT NHỊP, LẮNG NGHE CHÍNH MÌNH
                  </div>
                  <h1>
                    {tab === "personal" ? "Thiên hà của bạn" : "Thiên hà chung"}
                    <Sparkles size={24} />
                  </h1>
                  <p>
                    {tab === "personal"
                      ? "Mỗi cảm xúc là một vì sao. Và tất cả đều xứng đáng được tỏa sáng."
                      : "Có những tâm tư, khi được sẻ chia, sẽ tìm thấy một người đồng cảm."}
                  </p>
                </div>
                <button className="primary-button" onClick={() => compose()}>
                  <Plus size={18} />
                  Gửi một tâm tư
                </button>
              </div>
              <div className="galaxy-layout">
                <div className="galaxy-main">
                  <div className="galaxy-panel">
                    <div className="galaxy-toolbar">
                      <span>
                        <Orbit size={16} />
                        {tab === "personal"
                          ? "Vũ trụ nhỏ của bạn"
                          : "Những vì sao sẻ chia"}
                      </span>
                      <span className="private-label">
                        {tab === "personal" ? (
                          <LockKeyhole size={12} />
                        ) : (
                          <Globe2 size={12} />
                        )}
                        {tab === "personal"
                          ? "Riêng tư & an toàn"
                          : "Được chủ nhân công khai"}
                      </span>
                    </div>
                    <UniverseScene
                      shared={tab === "public"}
                      planetId={selectedPlanetId}
                      onPlanetChange={selectPlanet}
                      entries={visibleEntries}
                      onOpen={openEntry}
                      onCompose={() => compose()}
                      launch={launch}
                    />
                    <div className="galaxy-bottom">
                      <span>
                        <i className="status-dot" />
                        {mine.length} tâm tư{" "}
                        {tab === "personal"
                          ? "trong thiên hà của bạn"
                          : "của bạn"}
                      </span>
                      <span>
                        <LockKeyhole size={12} />
                        Bạn quyết định điều mình sẻ chia
                      </span>
                    </div>
                  </div>
                  {!state.user && (
                    <div className="guest-note">
                      <div className="note-icon">
                        <Moon size={19} />
                      </div>
                      <div>
                        <strong>
                          Cứ tự nhiên, bạn đang ở một nơi bình yên.
                        </strong>
                        <p>
                          Tâm tư của khách chỉ ở trong phiên này. Đăng ký để lưu
                          lại thiên hà của bạn.
                        </p>
                      </div>
                      <button onClick={() => setModal("auth")}>
                        Tạo thiên hà riêng
                        <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                  {selectedPlanetId && (
                    <details
                      key={`${tab}-${selectedPlanetId}`}
                      className="entries-section"
                    >
                      <summary>
                        Mở danh sách tâm tư ({visibleEntries.length})
                      </summary>
                      <div className="section-title">
                        <h2>
                          {tab === "personal"
                            ? "Những tâm tư đã gửi"
                            : "Lắng nghe những tâm tư"}
                          <span>{visibleEntries.length}</span>
                        </h2>
                        <label className="search-field">
                          <Search size={15} />
                          <input
                            aria-label="Tìm tâm tư"
                            placeholder="Tìm một tâm tư…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="filter-row">
                        <button
                          className={filter === "all" ? "selected" : ""}
                          onClick={() => setFilter("all")}
                        >
                          Tất cả
                        </button>
                        {(Object.keys(MOODS) as Mood[]).map((key) => (
                          <button
                            key={key}
                            className={filter === key ? "selected" : ""}
                            onClick={() => setFilter(key)}
                          >
                            <i style={{ background: MOODS[key].color }} />
                            {MOODS[key].label}
                          </button>
                        ))}
                      </div>
                      {visibleEntries.length ? (
                        <div className="entry-grid">
                          {visibleEntries.map((e) => (
                            <button
                              className={`entry-card ${e.mood}`}
                              key={e.id}
                              onClick={() => openEntry(e)}
                            >
                              <div className="entry-card-top">
                                <span style={{ color: MOODS[e.mood].color }}>
                                  ✦ {MOODS[e.mood].label}
                                </span>
                                <span>
                                  {e.visibility === "private" ? (
                                    <LockKeyhole size={13} />
                                  ) : (
                                    <Globe2 size={13} />
                                  )}
                                </span>
                              </div>
                              {e.authorPremium || e.mood === "sadness" ? (
                                <p className="concealed">
                                  <Eye size={20} />
                                  Chạm để mở tâm tư
                                </p>
                              ) : (
                                <p>{e.content}</p>
                              )}
                              <footer>
                                {e.owned ? "Bạn" : e.displayName}
                                <span>{date(e.createdAt)}</span>
                              </footer>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="empty-entries">
                          <Star size={23} />
                          <p>
                            {search || filter !== "all"
                              ? "Chưa có tâm tư phù hợp."
                              : "Chưa có tâm tư nào ở đây."}
                          </p>
                          <span>
                            {tab === "personal"
                              ? "Một dòng ngắn thôi cũng có thể trở thành một vì sao."
                              : "Khi ai đó sẵn sàng sẻ chia, bạn sẽ tìm thấy họ ở đây."}
                          </span>
                        </div>
                      )}
                    </details>
                  )}
                </div>
                <aside className="right-rail">
                  <div className="quote-card">
                    <span className="quote-icon">“</span>
                    <div className="tiny-label">MỘT LỜI NHẮN CHO BẠN</div>
                    <p>
                      Bạn không cần phải
                      <br />
                      <em>rực rỡ</em> mỗi ngày.
                      <br />
                      Chỉ cần là bạn,
                      <br />
                      vậy là đủ rồi.
                    </p>
                    <div className="quote-footer">
                      <span />
                      <Star size={13} />
                      <span />
                    </div>
                    <small>TỪ MỘT GÓC THIÊN HÀ</small>
                  </div>
                  <div className="mood-card">
                    <h3>Hôm nay, bạn thế nào?</h3>
                    <p>Mọi cảm xúc đều có một nơi để về.</p>
                    {(Object.keys(MOODS) as Mood[]).map((key) => (
                      <button key={key} onClick={() => compose(key)}>
                        <span className={`mood-symbol ${key}`}>
                          {key === "joy" ? (
                            <Star size={18} />
                          ) : key === "sadness" ? (
                            <Moon size={18} />
                          ) : (
                            <Heart size={18} />
                          )}
                        </span>
                        <span>
                          {MOODS[key].label}
                          <small>{MOODS[key].description}</small>
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    ))}
                  </div>
                  <button
                    className="future-promo"
                    onClick={() => setTab("letters")}
                  >
                    <span className="letter-orbit">
                      <Send size={23} />
                    </span>
                    <span>
                      <strong>Gửi đến bạn, ngày mai</strong>
                      <small>Một lá thư. Một cuộc hẹn với chính mình.</small>
                    </span>
                    <ArrowRight size={16} />
                  </button>
                  <div className="gentle-note">
                    <Heart size={14} />
                    <p>
                      sẽ có một ai đó xuất hiện và bên bạn, bạn không một mình
                      đâu
                    </p>
                  </div>
                </aside>
              </div>
            </>
          )}

          {tab === "letters" && (
            <>
              <PageTitle
                eyebrow="MỘT CUỘC HẸN VỚI CHÍNH MÌNH"
                title="Thư gửi tương lai"
                description="Gửi một lời nhắn vào hôm nay. Để tương lai ôm lấy bạn bằng chính những lời ấy."
                action={
                  <button
                    className="primary-button"
                    onClick={() => needsAccount(() => setModal("letter"))}
                  >
                    <Plus size={17} />
                    Viết một lá thư
                  </button>
                }
              />
              <div className="letter-banner">
                <div className="large-orbit">
                  <Send size={36} />
                </div>
                <div>
                  <h2>Có những lời, để ngày mai đọc.</h2>
                  <p>
                    Thư được khóa nội dung và ngày nhận sau khi gửi. Bạn có thể
                    xóa để hủy gửi bất kỳ lúc nào.
                  </p>
                  <small>
                    <Bell size={14} />
                    Nhận thông báo trong website; email khi được cấu hình và cho
                    phép.
                  </small>
                </div>
              </div>
              {state.letters.length ? (
                <div className="entry-grid">
                  {state.letters.map((letter) => (
                    <article className="letter-card" key={letter.id}>
                      <Send size={22} />
                      <span className="pill">
                        {letter.status === "delivered"
                          ? "Thư đã đến"
                          : "Đang du hành"}
                      </span>
                      <h3>Gửi bạn ngày {date(letter.deliverAt)}</h3>
                      <details>
                        <summary>
                          <Eye size={15} />
                          Xem nội dung thư
                        </summary>
                        <p className="pre-wrap">{letter.content}</p>
                      </details>
                      <button
                        className="text-danger"
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "Xóa lá thư này? Thư chưa đến hạn sẽ bị hủy gửi.",
                            )
                          )
                            void act("letter.delete", { id: letter.id });
                        }}
                      >
                        <Trash2 size={14} />
                        Xóa thư
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <Empty
                  icon={<Send size={32} />}
                  title="Hộp thư tương lai đang chờ bạn"
                  description="Viết cho một ngày đặc biệt, một cột mốc, hoặc chỉ là một ngày bạn muốn được nhắc rằng mình đã đi xa thế nào."
                  button={
                    <button
                      className="secondary-button"
                      onClick={() => needsAccount(() => setModal("letter"))}
                    >
                      Viết thư đầu tiên
                      <ArrowRight size={16} />
                    </button>
                  }
                />
              )}
            </>
          )}
          {tab === "groups" && (
            <>
              <PageTitle
                eyebrow="NHỮNG TÂM HỒN CÙNG TẦN SỐ"
                title="Vòng tròn kết nối"
                description="Một không gian nhỏ để cùng nhau sẻ chia, khi bạn đã sẵn sàng."
              />
              <div className="two-column">
                <section className="surface">
                  <h2>Tạo vòng tròn của bạn</h2>
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (!state.user) {
                        setModal("auth");
                        return;
                      }
                      const form = new FormData(event.currentTarget);
                      if (
                        await act("group.create", {
                          name: form.get("name"),
                          password: form.get("password") || undefined,
                        })
                      )
                        setToast("Vòng tròn của bạn đã được tạo.");
                    }}
                  >
                    <Field label="Tên vòng tròn">
                      <input
                        name="name"
                        required
                        maxLength={80}
                        placeholder="Một góc nhỏ của chúng mình"
                      />
                    </Field>
                    <Field label="Mật khẩu (không bắt buộc)">
                      <input
                        name="password"
                        type="password"
                        minLength={4}
                        placeholder="Để trống nếu muốn mở cửa đón mọi người"
                      />
                    </Field>
                    <button className="primary-button" disabled={busy}>
                      <Plus size={16} />
                      Tạo vòng tròn
                    </button>
                  </form>
                </section>
                <section className="surface">
                  <h2>Tin nhắn chờ</h2>
                  {state.requests.length ? (
                    state.requests.map((r) => (
                      <div className="request-row" key={r.id}>
                        <span>
                          {r.incoming ? r.fromName : "Lời mời bạn đã gửi"}
                          <small>
                            {r.status === "pending"
                              ? "Đang chờ kết nối"
                              : r.status === "accepted"
                                ? "Đã kết nối"
                                : "Đã từ chối"}
                          </small>
                        </span>
                        {r.status === "accepted" && (
                          <button
                            className="secondary-button"
                            onClick={() => void readPeer(r.id)}
                          >
                            <MessageCircle size={14} />
                            Trò chuyện
                          </button>
                        )}
                        {r.incoming && r.status === "pending" && (
                          <>
                            <button
                              className="icon-button"
                              aria-label="Chấp nhận"
                              disabled={busy}
                              onClick={() =>
                                void act("connection.respond", {
                                  id: r.id,
                                  accept: true,
                                })
                              }
                            >
                              <Check size={17} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label="Từ chối"
                              disabled={busy}
                              onClick={() =>
                                void act("connection.respond", {
                                  id: r.id,
                                  accept: false,
                                })
                              }
                            >
                              <X size={17} />
                            </button>
                          </>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="muted">Chưa có lời mời kết nối.</p>
                  )}
                </section>
              </div>
              <div className="group-grid">
                {state.groups.map((group) => (
                  <section className="surface" key={group.id}>
                    <div className="section-title">
                      <Users size={23} />
                      {group.locked && <LockKeyhole size={15} />}
                      {state.user?.id === group.ownerId && (
                        <button
                          className="text-danger"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              !confirm(
                                `Xóa nhóm “${group.name}”? Không thể khôi phục nhóm. Tâm tư của mọi thành viên sẽ được giữ lại và chuyển về riêng tư, chỉ tác giả xem được.`,
                              )
                            )
                              return;
                            if (await act("group.delete", { id: group.id })) {
                              setComposeGroup("");
                              setEntry(null);
                              setToast(
                                "Đã xóa nhóm. Tâm tư của mọi thành viên đã được giữ lại và chuyển về riêng tư.",
                              );
                            }
                          }}
                        >
                          <Trash2 size={14} />
                          Xóa nhóm
                        </button>
                      )}
                    </div>
                    <h3>{group.name}</h3>
                    <p className="muted">
                      {group.memberCount} thành viên ·{" "}
                      {group.locked ? "Có mật khẩu" : "Mở cho mọi người"}
                    </p>
                    {group.joined ? (
                      <>
                        <button
                          className="secondary-button"
                          onClick={() => {
                            setComposeGroup(group.id);
                            setModal("compose");
                          }}
                        >
                          <Plus size={15} />
                          Chia sẻ trong nhóm
                        </button>
                        <div className="group-entries">
                          {allEntries
                            .filter((e) => e.groupId === group.id)
                            .map((e) => (
                              <button key={e.id} onClick={() => openEntry(e)}>
                                {e.authorPremium || e.mood === "sadness"
                                  ? "Tâm tư được cất giữ · Chạm để xem"
                                  : e.content.slice(0, 100)}
                                <small>{e.displayName}</small>
                              </button>
                            ))}
                        </div>
                      </>
                    ) : (
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          needsAccount(() => {
                            const password = group.locked
                              ? prompt("Nhập mật khẩu vòng tròn")
                              : undefined;
                            if (password !== null)
                              void act("group.join", {
                                id: group.id,
                                password,
                              });
                          })
                        }
                      >
                        Tham gia
                        <ArrowRight size={15} />
                      </button>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}
          {tab === "chat" && (
            <>
              <PageTitle
                eyebrow="Ở ĐÂY, CÓ MỘT NGƯỜI LẮNG NGHE"
                title="Bạn không một mình"
                description="Cứ kể chậm thôi. Những điều trong lòng bạn đều đáng được lắng nghe."
              />
              <div className="chat-layout">
                <section className="chat-panel">
                  <div className="chat-header">
                    <span className="chat-avatar">
                      <Sparkles size={22} />
                    </span>
                    <div>
                      <strong>
                        {state.chat.status === "human"
                          ? "Người hỗ trợ"
                          : state.chat.status === "waiting"
                            ? "Đang chờ người hỗ trợ"
                            : "Người bạn AI"}
                      </strong>
                      <small>
                        {state.chat.status === "ai"
                          ? "Trò chuyện cùng trí tuệ nhân tạo"
                          : "Danh tính cá nhân của người hỗ trợ được ẩn"}
                      </small>
                    </div>
                    <span className="pill">
                      {state.chat.status === "ai"
                        ? `${state.chat.remaining}/5 lượt còn lại`
                        : "Premium"}
                    </span>
                  </div>
                  <div className="chat-messages" aria-live="polite">
                    {state.chat.messages.length ? (
                      state.chat.messages.map((message) => (
                        <div
                          key={message.id}
                          className={`chat-bubble ${message.kind}`}
                        >
                          <small>
                            {message.kind === "user"
                              ? "Bạn"
                              : message.kind === "ai"
                                ? "AI"
                                : "Người hỗ trợ"}
                          </small>
                          <p>{message.content}</p>
                        </div>
                      ))
                    ) : (
                      <div className="chat-welcome">
                        <div className="chat-welcome-icon">
                          <Orbit size={46} strokeWidth={1} />
                        </div>
                        <h2>Hôm nay của bạn thế nào?</h2>
                        <p>
                          Bạn có thể bắt đầu từ bất cứ điều gì.
                          <br />
                          Không cần sắp xếp câu chữ thật hoàn hảo.
                        </p>
                        <div className="chat-suggestions">
                          {[
                            "Hôm nay mình cảm thấy hơi mệt…",
                            "Mình có một niềm vui muốn kể",
                            "Có điều mình chưa biết nói với ai",
                          ].map((text) => (
                            <button
                              key={text}
                              onClick={() => setChatText(text)}
                            >
                              {text}
                              <ArrowRight size={14} />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  {state.chat.status === "waiting" && (
                    <div className="chat-status">
                      <Clock3 size={17} />
                      Bạn đang trong hàng chờ. Mục tiêu phản hồi: tối đa 1
                      tiếng.
                    </div>
                  )}
                  {state.chat.cooldownUntil &&
                    new Date(state.chat.cooldownUntil) > new Date() && (
                      <div className="chat-status">
                        <Clock3 size={17} />
                        Lượt mới mở lúc{" "}
                        {new Date(state.chat.cooldownUntil).toLocaleTimeString(
                          "vi-VN",
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                        . Bạn cũng có thể khám phá Premium.
                      </div>
                    )}
                  {!state.config.aiEnabled && state.chat.status === "ai" && (
                    <div className="chat-status">
                      <CircleHelp size={17} />
                      AI chưa được kết nối. Tính năng sẽ hoạt động khi nhà phát
                      hành cấu hình dịch vụ.
                    </div>
                  )}
                  <form
                    className="chat-form"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (!state.user) {
                        setModal("auth");
                        return;
                      }
                      if (await act("chat.send", { content: chatText }))
                        setChatText("");
                    }}
                  >
                    <textarea
                      aria-label="Nội dung tin nhắn"
                      placeholder="Viết những điều đang ở trong lòng bạn…"
                      value={chatText}
                      onChange={(e) => setChatText(e.target.value)}
                      maxLength={4000}
                      rows={2}
                    />
                    <button
                      className="send-button"
                      disabled={
                        busy ||
                        !chatText.trim() ||
                        (!!state.user &&
                          state.chat.status === "ai" &&
                          !state.config.aiEnabled)
                      }
                      aria-label="Gửi tin nhắn"
                    >
                      <Send size={19} />
                    </button>
                  </form>
                  <div className="chat-disclaimer">
                    Tin nhắn AI được gửi đến dịch vụ AI để tạo phản hồi. Không
                    gian sẻ chia cảm xúc, không thay thế dịch vụ cấp cứu hoặc
                    điều trị chuyên môn.
                  </div>
                </section>
                <aside className="surface chat-info">
                  <Heart size={26} />
                  <h3>Có một nơi để trở về</h3>
                  <p>
                    5 tin nhắn AI mỗi lượt. Sau đó chờ 2 tiếng để bắt đầu lượt
                    tiếp theo.
                  </p>
                  <hr />
                  <h3>Đồng hành cùng Premium</h3>
                  <p>
                    Gửi tâm sự 24/7 với chuyên gia hoặc quản trị viên. Mục tiêu
                    phản hồi trong 1 tiếng, không thu thêm phí trò chuyện.
                  </p>
                  <button
                    className="secondary-button"
                    onClick={() => setModal("premium")}
                  >
                    Tìm hiểu Premium
                    <ArrowRight size={15} />
                  </button>
                </aside>
              </div>
            </>
          )}
          {tab === "settings" && (
            <>
              <PageTitle
                eyebrow="BẠN LÀ NGƯỜI QUYẾT ĐỊNH"
                title="Cài đặt & quyền riêng tư"
                description="Một nơi bình yên bắt đầu từ việc bạn biết dữ liệu của mình được sử dụng thế nào."
              />
              <div className="two-column">
                <section className="surface">
                  <h2>Tài khoản của bạn</h2>
                  {state.user ? (
                    <>
                      <p>
                        {state.user.name}{" "}
                        {state.user.verified && (
                          <CheckCircle2 size={17} className="verified" />
                        )}
                      </p>
                      <p className="muted">{state.user.email}</p>
                      <p className="muted">
                        {state.user.emailVerified
                          ? "Email đã xác minh"
                          : "Email chưa xác minh"}
                      </p>
                      {!state.user.emailVerified && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void verifyEmail()}
                        >
                          Gửi thư xác minh email
                          <ArrowRight size={14} />
                        </button>
                      )}
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={!!state.user.emailNotifications}
                          disabled={busy || !state.user.emailVerified}
                          onChange={(event) =>
                            void act("account.notifications", {
                              enabled: event.target.checked,
                            })
                          }
                        />
                        Nhận thông báo qua email đã xác minh
                      </label>
                      {!!state.user.linkedProviders?.length && (
                        <p className="muted">
                          Đã liên kết: {state.user.linkedProviders.join(", ")}
                        </p>
                      )}
                      <p className="muted">
                        {premium
                          ? `Premium đến ${date(state.user.premiumUntil!)}`
                          : "Tài khoản miễn phí"}
                      </p>
                      {state.config.billingEnabled && (
                        <button
                          className="secondary-button billing-manage"
                          disabled={busy}
                          onClick={() => void billingPortal()}
                        >
                          Quản lý gói Premium
                          <ArrowRight size={14} />
                        </button>
                      )}
                      <button
                        className="secondary-button"
                        onClick={() => void logout()}
                        disabled={busy}
                      >
                        <LogOut size={16} />
                        Đăng xuất
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="muted">
                        Bạn đang dùng phiên khách. Nội dung thử nghiệm không
                        được lưu khi tải lại hoặc rời trang.
                      </p>
                      <button
                        className="primary-button"
                        onClick={() => setModal("auth")}
                      >
                        Đăng ký / Đăng nhập
                      </button>
                    </>
                  )}
                  {state.config.oauthProviders.length > 0 && (
                    <>
                      <h3>Tài khoản liên kết</h3>
                      <p className="muted">
                        Liên kết để đăng nhập. Kênh thông báo phụ thuộc quyền và
                        dịch vụ được hỗ trợ.
                      </p>
                      {state.config.oauthProviders.map((provider) => (
                        <a
                          className="secondary-button oauth-link"
                          key={provider}
                          href={`/api/oauth/${provider}`}
                        >
                          {provider === "google"
                            ? "Google"
                            : provider === "apple"
                              ? "Apple"
                              : "Facebook"}
                          <ArrowRight size={14} />
                        </a>
                      ))}
                    </>
                  )}
                </section>
                <section className="surface">
                  <ShieldCheck size={27} />
                  <h2>Dữ liệu thuộc về bạn</h2>
                  <p className="muted">
                    Nội dung được lưu khi gửi. Chu kỳ đồng bộ định kỳ là 1
                    tiếng. Bản sao lưu chỉ dùng để phục hồi sự cố và được lưu
                    tối đa {state.config.backupRetentionDays} ngày.
                  </p>
                  <p className="muted">
                    Khi yêu cầu xóa hoàn toàn, dữ liệu được xóa khỏi hệ thống
                    hoạt động; bản sao lưu hết hạn theo thời hạn công bố. Dữ
                    liệu đã xóa không được khôi phục trở lại tài khoản.
                  </p>
                  <p className="muted">
                    Bạn chọn từng nội dung muốn công khai hoặc chia sẻ với đội
                    ngũ hỗ trợ Premium.
                  </p>
                </section>
              </div>
              {state.user && (
                <section className="surface danger-zone">
                  <h2>Xóa tài khoản và dữ liệu</h2>
                  <p>
                    Thao tác này không thể hoàn tác. Các thư chưa đến hạn sẽ bị
                    hủy. Thời hạn xử lý bản sao lưu: tối đa{" "}
                    {state.config.backupRetentionDays} ngày.
                  </p>
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (
                        !confirm(
                          "Bạn chắc chắn muốn xóa vĩnh viễn tài khoản và dữ liệu?",
                        )
                      )
                        return;
                      const form = new FormData(event.currentTarget);
                      if (
                        await act("account.delete", {
                          password: form.get("password") || undefined,
                          confirmation: form.get("confirmation"),
                        })
                      ) {
                        setTab("personal");
                        setToast(
                          "Đã xử lý yêu cầu xóa tài khoản. Bản sao lưu sẽ hết hạn theo chính sách công bố.",
                        );
                      }
                    }}
                  >
                    {state.user.hasPassword !== false ? (
                      <Field label="Mật khẩu tài khoản">
                        <input name="password" type="password" required />
                      </Field>
                    ) : (
                      <p className="form-note">
                        Để xác nhận xóa, bạn cần vừa đăng nhập bằng tài khoản
                        liên kết trong vòng 15 phút.
                      </p>
                    )}
                    <Field label="Nhập XOA VINH VIEN để xác nhận">
                      <input
                        name="confirmation"
                        required
                        pattern="XOA VINH VIEN"
                        autoComplete="off"
                      />
                    </Field>
                    <button className="danger-button" disabled={busy}>
                      <Trash2 size={16} />
                      Xóa hoàn toàn
                    </button>
                  </form>
                </section>
              )}
            </>
          )}
          {tab === "support" && state.user && state.user.role !== "user" && (
            <>
              <PageTitle
                eyebrow="KHÔNG GIAN DÀNH CHO ĐỘI NGŨ"
                title="Lắng nghe & đồng hành"
                description="Chỉ truy cập tâm tư Premium được chia sẻ để hỗ trợ. Danh tính cá nhân của người hỗ trợ được ẩn."
              />
              <div className="two-column">
                <section className="surface">
                  <h2>Hàng chờ Premium</h2>
                  {state.staffQueue.length ? (
                    state.staffQueue.map((ticket) => (
                      <div className="ticket-row" key={ticket.id}>
                        <div>
                          <strong>{ticket.name}</strong>
                          <small>
                            {ticket.status} ·{" "}
                            {new Date(ticket.createdAt).toLocaleString("vi-VN")}
                            {ticket.overdue && " · Đã quá 1 tiếng"}
                          </small>
                        </div>
                        <button
                          className="secondary-button"
                          onClick={async () => {
                            if (
                              ticket.status === "waiting" &&
                              !(await act("support.claim", { id: ticket.id }))
                            )
                              return;
                            await readTicket(ticket.id);
                          }}
                        >
                          Mở
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="muted">Chưa có người dùng đang chờ hỗ trợ.</p>
                  )}
                </section>
                <section className="surface">
                  <h2>Phiên hỗ trợ</h2>
                  {support ? (
                    <>
                      <div className="support-messages">
                        {support.messages.map((message) => (
                          <div
                            className={`chat-bubble ${message.kind}`}
                            key={message.id}
                          >
                            <small>
                              {message.kind === "user"
                                ? "Người dùng"
                                : message.kind === "ai"
                                  ? "AI"
                                  : "Người hỗ trợ"}
                            </small>
                            <p>{message.content}</p>
                          </div>
                        ))}
                      </div>
                      {support.entries.map((e) => (
                        <button
                          className="support-entry"
                          key={e.id}
                          onClick={() => openEntry(e)}
                        >
                          <Eye size={15} />
                          Tâm tư được chia sẻ · {MOODS[e.mood].label}
                        </button>
                      ))}
                      <form
                        onSubmit={async (event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          if (
                            await act("support.reply", {
                              id: ticketId,
                              content: form.get("content"),
                            })
                          )
                            await readTicket(ticketId);
                        }}
                      >
                        <Field label="Trả lời với tư cách người hỗ trợ">
                          <textarea
                            name="content"
                            required
                            maxLength={4000}
                            rows={3}
                          />
                        </Field>
                        <button className="primary-button" disabled={busy}>
                          <Send size={16} />
                          Gửi phản hồi
                        </button>
                      </form>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={async () => {
                          if (await act("support.close", { id: ticketId })) {
                            setSupport(null);
                            setTicketId("");
                          }
                        }}
                      >
                        Kết thúc phiên hỗ trợ
                      </button>
                    </>
                  ) : (
                    <p className="muted">
                      Chọn một phiên ở hàng chờ để bắt đầu.
                    </p>
                  )}
                </section>
              </div>
              {state.user.role === "admin" && (
                <section className="surface">
                  <h2>Cấp quyền chuyên gia</h2>
                  <p className="muted">
                    Nhà phát hành chịu trách nhiệm xác minh trước khi cấp tích
                    xanh.
                  </p>
                  <form
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      if (
                        await act("admin.role", {
                          email: form.get("email"),
                          role: form.get("role"),
                        })
                      )
                        setToast("Đã cập nhật quyền tài khoản.");
                    }}
                  >
                    <Field label="Email tài khoản">
                      <input name="email" type="email" required />
                    </Field>
                    <Field label="Vai trò">
                      <select name="role">
                        <option value="expert">Chuyên gia đã xác minh</option>
                        <option value="user">Người dùng thường</option>
                      </select>
                    </Field>
                    <button className="primary-button" disabled={busy}>
                      Cập nhật quyền
                    </button>
                  </form>
                </section>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>✦ COSMIC ECHO</span>
            <p>Gửi nỗi lòng vào thiên hà, nhận lại sự bình yên.</p>
            <span>Được tạo nên bằng sự lắng nghe</span>
          </footer>
        </main>
      </div>
      {!loaded && (
        <span className="loading-indicator" role="status">
          Đang mở thiên hà…
        </span>
      )}
      {toast && (
        <div className="toast" role="status">
          <Sparkles size={18} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="Đóng thông báo">
            <X size={17} />
          </button>
        </div>
      )}
      {modal && (
        <Modal
          onClose={() => setModal(null)}
          title={
            modal === "compose"
              ? "Gửi một tâm tư"
              : modal === "auth"
                ? "Thiên hà riêng, dành cho bạn"
                : modal === "premium"
                  ? "Một người đồng hành"
                  : modal === "letter"
                    ? "Gửi đến bạn của tương lai"
                    : "Thông báo & kết nối"
          }
        >
          {modal === "compose" && (
            <form onSubmit={submitEntry}>
              <p className="modal-intro">
                Cứ viết những gì bạn đang cảm thấy. Ở đây, bạn được là chính
                mình.
              </p>
              <div className="mood-picker">
                {(Object.keys(MOODS) as Mood[]).map((key) => (
                  <button
                    type="button"
                    key={key}
                    className={mood === key ? "selected" : ""}
                    onClick={() => setMood(key)}
                  >
                    <span style={{ color: MOODS[key].color }}>✦</span>
                    {MOODS[key].label}
                  </button>
                ))}
              </div>
              <Field label="Điều bạn muốn gửi vào thiên hà">
                <textarea
                  name="content"
                  placeholder="Hôm nay, mình…"
                  rows={5}
                  required
                  maxLength={5000}
                  autoFocus
                />
              </Field>
              <Field label="Gửi tâm tư đến hành tinh">
                <select
                  name="planetId"
                  defaultValue={selectedPlanetId || DEFAULT_PLANET_ID}
                >
                  {PLANETS.map((planet) => (
                    <option key={planet.id} value={planet.id}>
                      {planet.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Ai được nhìn thấy tâm tư này?">
                <select
                  name="visibility"
                  defaultValue={
                    composeGroup
                      ? "group"
                      : state.user && tab === "public"
                        ? "public"
                        : "private"
                  }
                >
                  <option value="private">Chỉ mình tôi</option>
                  {state.user && (
                    <option value="public">
                      Công khai trong thiên hà chung
                    </option>
                  )}
                  {state.user && state.groups.some((g) => g.joined) && (
                    <option value="group">Vòng tròn đã tham gia</option>
                  )}
                </select>
              </Field>
              <Field label="Danh tính khi chia sẻ">
                <select name="identity" defaultValue="anonymous">
                  <option value="anonymous">Ẩn danh</option>
                  <option value="nickname">Biệt danh</option>
                  <option value="real">Tên tài khoản</option>
                </select>
              </Field>
              <Field label="Biệt danh (nếu chọn)">
                <input
                  name="nickname"
                  maxLength={50}
                  placeholder="Một ngôi sao nhỏ"
                />
              </Field>
              {state.groups.some((g) => g.joined) && (
                <Field label="Vòng tròn (khi chọn chia sẻ trong nhóm)">
                  <select
                    name="groupId"
                    defaultValue={composeGroup || undefined}
                  >
                    {state.groups
                      .filter((g) => g.joined)
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
              {premium && (
                <label className="checkbox-label">
                  <input name="supportVisible" type="checkbox" />
                  Cho phép chuyên gia và quản trị viên đọc tâm tư riêng này để
                  hỗ trợ tôi.
                </label>
              )}
              {!state.user && (
                <p className="form-note">
                  Khách chỉ lưu tâm tư riêng trong phiên này. Đăng nhập để lưu
                  lâu dài hoặc công khai.
                </p>
              )}
              <button className="primary-button full-width" disabled={busy}>
                <Sparkles size={17} />
                {busy ? "Đang gửi…" : "Thả một vì sao vào thiên hà"}
              </button>
            </form>
          )}
          {modal === "auth" && (
            <form onSubmit={submitAuth}>
              <p className="modal-intro">
                Lưu lại những cảm xúc, để mỗi lần trở về đều tìm thấy chính
                mình.
              </p>
              {!!guestEntries.length && (
                <p className="form-note">
                  Tâm tư của phiên khách không tự chuyển vào tài khoản. Bạn hãy
                  sao chép nội dung muốn giữ trước khi đăng nhập hoặc tạo tài
                  khoản.
                </p>
              )}
              <div className="auth-tabs">
                <button
                  type="button"
                  className={authMode === "register" ? "selected" : ""}
                  onClick={() => setAuthMode("register")}
                >
                  Tạo tài khoản
                </button>
                <button
                  type="button"
                  className={authMode === "login" ? "selected" : ""}
                  onClick={() => setAuthMode("login")}
                >
                  Đăng nhập
                </button>
              </div>
              {authMode === "register" && (
                <Field label="Tên bạn muốn được gọi">
                  <input
                    name="name"
                    required
                    maxLength={60}
                    autoComplete="name"
                  />
                </Field>
              )}
              <Field label="Email">
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                />
              </Field>
              <Field label="Mật khẩu">
                <input
                  name="password"
                  type="password"
                  required
                  minLength={10}
                  autoComplete={
                    authMode === "register"
                      ? "new-password"
                      : "current-password"
                  }
                  placeholder="Ít nhất 10 ký tự"
                />
              </Field>
              <button className="primary-button full-width" disabled={busy}>
                {busy
                  ? "Đang kết nối…"
                  : authMode === "register"
                    ? "Bắt đầu thiên hà của bạn"
                    : "Trở về thiên hà"}
                <ArrowRight size={16} />
              </button>
              {state.config.oauthProviders.map((provider) => (
                <a
                  className="secondary-button full-width oauth-link"
                  key={provider}
                  href={`/api/oauth/${provider}`}
                >
                  Tiếp tục với{" "}
                  {provider === "google"
                    ? "Google"
                    : provider === "apple"
                      ? "Apple"
                      : "Facebook"}
                </a>
              ))}
              <p className="form-note">
                Bạn kiểm soát nội dung công khai và có quyền xóa hoàn toàn dữ
                liệu. Bản sao lưu phục hồi được giữ tối đa{" "}
                {state.config.backupRetentionDays} ngày.
              </p>
            </form>
          )}
          {modal === "premium" && (
            <div className="premium-modal">
              <div className="premium-orbit">
                <Sparkles size={35} />
              </div>
              <p className="modal-intro">
                sẽ có một ai đó xuất hiện và bên bạn, bạn không một mình đâu
              </p>
              <div className="price">
                $10<span> / tháng</span>
              </div>
              <ul>
                {[
                  "Chuyên gia được nhà phát hành xác minh",
                  "Gửi tâm sự cho người hỗ trợ 24/7",
                  "Mục tiêu phản hồi trong tối đa 1 tiếng",
                  "Không thu thêm phí trò chuyện với quản trị viên",
                  "Tâm tư riêng được che và kiểm soát quyền đọc",
                ].map((text) => (
                  <li key={text}>
                    <CheckCircle2 size={17} />
                    {text}
                  </li>
                ))}
              </ul>
              {premium ? (
                <p className="success-note">
                  Bạn đang có Premium đến {date(state.user!.premiumUntil!)}.
                </p>
              ) : (
                <>
                  <button
                    className="primary-button full-width"
                    disabled={busy || !state.config.billingEnabled}
                    onClick={() => void checkout()}
                  >
                    {state.config.billingEnabled
                      ? "Đăng ký Premium"
                      : "Thanh toán chưa được mở"}
                    <ArrowRight size={17} />
                  </button>
                  {!state.config.billingEnabled && (
                    <p className="form-note">
                      Nhà phát hành đang chuẩn bị dịch vụ và cổng thanh toán.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {modal === "letter" && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const deliverAt = new Date(String(form.get("deliverAt")));
                if (
                  !Number.isFinite(deliverAt.getTime()) ||
                  deliverAt <= new Date()
                ) {
                  setToast("Hãy chọn một thời điểm trong tương lai.");
                  return;
                }
                if (
                  await act("letter.create", {
                    content: form.get("content"),
                    deliverAt: deliverAt.toISOString(),
                  })
                ) {
                  setModal(null);
                  setToast("Thư của bạn đã bắt đầu chuyến du hành.");
                }
              }}
            >
              <p className="modal-intro">
                Khi đến hẹn, lá thư sẽ tìm đường trở về với bạn.
              </p>
              <Field label="Nội dung lá thư">
                <textarea
                  name="content"
                  required
                  maxLength={10000}
                  rows={7}
                  placeholder="Gửi mình của tương lai…"
                />
              </Field>
              <Field label="Ngày và giờ nhận (theo múi giờ thiết bị của bạn)">
                <input name="deliverAt" type="datetime-local" required />
              </Field>
              <p className="form-note">
                Sau khi gửi, bạn không thể sửa nội dung hoặc thời điểm nhận. Bạn
                vẫn có thể xóa để hủy thư.
              </p>
              <button className="primary-button full-width" disabled={busy}>
                <Send size={17} />
                Xác nhận gửi vào tương lai
              </button>
            </form>
          )}
          {modal === "notices" && (
            <>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void act("notifications.read")}
              >
                Đánh dấu tất cả đã đọc
                <Check size={15} />
              </button>
              {state.notifications.length ? (
                state.notifications.map((notice) => (
                  <div
                    className={`notice ${notice.read ? "read" : ""}`}
                    key={notice.id}
                  >
                    <Bell size={17} />
                    <div>
                      <p>{notice.text}</p>
                      <small>{date(notice.createdAt)}</small>
                    </div>
                  </div>
                ))
              ) : (
                <p className="modal-intro">
                  Chưa có thông báo mới. Thiên hà vẫn ở đây, chờ bạn.
                </p>
              )}
              <button
                className="secondary-button full-width"
                onClick={() => {
                  setModal(null);
                  setTab("groups");
                }}
              >
                Mở tin nhắn chờ
                <ArrowRight size={16} />
              </button>
            </>
          )}
        </Modal>
      )}
      {peer && (
        <Modal title="Một cuộc trò chuyện" onClose={() => setPeer(null)}>
          <div className="peer-toolbar">
            <span>Hai người đã đồng ý kết nối.</span>
            <button
              className="text-button"
              onClick={() => void readPeer(peer.id)}
            >
              Làm mới
            </button>
          </div>
          <div className="support-messages">
            {peer.messages.length ? (
              peer.messages.map((message) => (
                <div
                  key={message.id}
                  className={`chat-bubble ${message.kind === "self" ? "user" : "support"}`}
                >
                  <small>
                    {message.kind === "self" ? "Bạn" : "Người bạn kết nối"}
                  </small>
                  <p>{message.content}</p>
                </div>
              ))
            ) : (
              <p className="modal-intro">
                Bắt đầu bằng một lời chào nhẹ nhàng.
              </p>
            )}
          </div>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const element = event.currentTarget;
              const form = new FormData(element);
              if (
                await act("connection.message", {
                  id: peer.id,
                  content: form.get("content"),
                })
              ) {
                element.reset();
                await readPeer(peer.id);
              }
            }}
          >
            <Field label="Tin nhắn">
              <textarea name="content" required maxLength={4000} rows={3} />
            </Field>
            <button className="primary-button full-width" disabled={busy}>
              <Send size={16} />
              Gửi tin nhắn
            </button>
          </form>
        </Modal>
      )}
      {entry && (
        <Modal onClose={() => setEntry(null)} title={MOODS[entry.mood].label}>
          <div className="entry-detail-meta">
            <span>✦ {entry.displayName}</span>
            <span>{date(entry.createdAt)}</span>
          </div>
          {revealed ? (
            <p className="entry-detail-content">{entry.content}</p>
          ) : (
            <div className="reveal-panel">
              <Eye size={30} />
              <h3>
                {entry.mood === "sadness"
                  ? "Bạn đã sẵn sàng nhìn lại?"
                  : "Một tâm tư được cất giữ"}
              </h3>
              <p>
                {entry.mood === "sadness"
                  ? "Hãy mở khi bạn cảm thấy thoải mái. Bạn có thể quay lại bất cứ lúc nào."
                  : "Nội dung được che để bạn chủ động lựa chọn lúc đọc."}
              </p>
              <button
                className="secondary-button"
                onClick={() => setRevealed(true)}
              >
                <Eye size={15} />
                Mình muốn đọc
              </button>
            </div>
          )}
          <div className="detail-actions">
            {entry.owned ? (
              <button
                className="text-danger"
                disabled={busy}
                onClick={async () => {
                  if (!confirm("Xóa hoàn toàn tâm tư này?")) return;
                  if (!state.user) {
                    setGuestEntries((old) =>
                      old.filter((e) => e.id !== entry.id),
                    );
                    setEntry(null);
                  } else if (await act("entry.delete", { id: entry.id }))
                    setEntry(null);
                }}
              >
                <Trash2 size={15} />
                Xóa tâm tư
              </button>
            ) : (
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  needsAccount(() => {
                    void act("connection.request", {
                      toId: entry.authorId,
                    }).then((ok) => {
                      if (ok) setToast("Đã gửi lời mời kết nối.");
                    });
                  })
                }
              >
                <Heart size={15} />
                Gửi lời mời kết nối
              </button>
            )}
            <span>
              <LockKeyhole size={12} />
              {entry.visibility === "private"
                ? "Riêng tư"
                : entry.visibility === "group"
                  ? "Trong vòng tròn"
                  : "Công khai"}
            </span>
          </div>
        </Modal>
      )}
    </div>
  );
}
function ArrowUpRight() {
  return <ArrowRight size={14} style={{ transform: "rotate(-35deg)" }} />;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">
          <span />
          {eyebrow}
        </div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
function Empty({
  icon,
  title,
  description,
  button,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  button?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {button}
    </div>
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "[autofocus], input, textarea, select, button, a[href]",
    );
    first?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
          if (event.key !== "Tab") return;
          const items = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
              "button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary",
            ) || [],
          );
          const first = items[0];
          const last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
          >
            <X size={20} />
          </button>
        </div>
        {children}
      </section>
    </div>
  );
}
