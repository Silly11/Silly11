"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Entry } from "@/lib/types";
import { PLANETS, type PlanetId } from "@/lib/planets";
import styles from "./universe-scene.module.css";

const MOODS = { joy: "Niềm vui", sadness: "Nỗi buồn", unsaid: "Lời gửi gió" };
const ORBITS = PLANETS.map((planet, index) => ({
  ...planet,
  rx: 156 + index * 50,
  ry: 84 + index * 24,
}));
const BACKGROUND = Array.from({ length: 210 }, (_, i) => ({
  x: (i * 37.17 + 9) % 100,
  y: (i * 23.73 + 5) % 100,
}));
function location(id: string) {
  let hash = 0;
  for (const char of id)
    hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return {
    left: `${6 + (hash % 880) / 10}%`,
    top: `${8 + ((hash >>> 10) % 650) / 10}%`,
    animationDelay: `${-(hash % 50) / 10}s`,
  };
}

export default function UniverseScene({
  shared,
  planetId,
  onPlanetChange,
  entries,
  onOpen,
  onCompose,
  launch,
}: {
  shared: boolean;
  planetId: PlanetId | "";
  onPlanetChange: (planetId: PlanetId | "") => void;
  entries: Entry[];
  onOpen: (entry: Entry) => void;
  onCompose: () => void;
  launch: { sequence: number; public: boolean; planetId: PlanetId } | null;
}) {
  const [paused, setPaused] = useState(false);
  const destinationHeading = useRef<HTMLHeadingElement>(null);
  const planet = PLANETS.find((p) => p.id === planetId);
  const planetEntries = planet
    ? entries.filter((e) => e.planetId === planet.id)
    : [];
  useEffect(() => {
    if (planet) destinationHeading.current?.focus({ preventScroll: true });
  }, [planet]);
  return (
    <section
      className={styles.universe}
      data-private={!shared}
      aria-label={shared ? "Hệ hành tinh chung" : "Bầu trời riêng"}
    >
      <div className={styles.controls}>
        <label className={styles.picker}>
          Nơi dừng chân
          <select
            aria-label="Chọn hành tinh"
            value={planetId}
            onChange={(e) => onPlanetChange(e.target.value as PlanetId | "")}
          >
            <option value="">Toàn cảnh hệ hành tinh</option>
            {PLANETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? "Tiếp tục chuyển động" : "Tạm dừng chuyển động"}
        </button>
      </div>
      {planet && (
        <div className={styles.destination}>
          <h2 ref={destinationHeading} tabIndex={-1}>
            {planet.name}
          </h2>
          <p>
            {shared
              ? "Những tâm tư được sẻ chia"
              : "Góc lưu giữ tâm tư của bạn"}
            {" · "}
            {planetEntries.length} tâm tư hiển thị
          </p>
        </div>
      )}
      <div
        className={styles.sky}
        data-paused={paused}
        data-view={planet?.id || "system"}
      >
        <div className={styles.dust} aria-hidden="true" />
        <div className={styles.constellations} aria-hidden="true">
          {BACKGROUND.map((p, i) => (
            <span
              key={i}
              className={styles.distantStar}
              style={{
                left: `${p.x}%`,
                top: `${p.y}%`,
                animationDelay: `${-i * 0.7}s`,
                animationDuration: `${4 + (i % 7) * 0.6}s`,
                fontSize: i % 11 === 0 ? 12 : i % 3 === 0 ? 8 : 5,
              }}
            >
              ✦
            </span>
          ))}
        </div>
        {!planet && (
          <div
            className={styles.systemViewport}
            role="group"
            aria-label="Bản đồ hành tinh quay quanh Mặt Trời"
          >
            <div className={styles.system}>
              <svg
                className={styles.orbitLines}
                viewBox="0 0 1200 600"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {ORBITS.map((p) => (
                  <ellipse key={p.id} cx="600" cy="300" rx={p.rx} ry={p.ry} />
                ))}
              </svg>
              <div className={styles.sun} aria-label="Mặt Trời" role="img" />
              <span className={styles.sunLabel}>Mặt Trời</span>
              {ORBITS.map((p) => (
                <div
                  key={p.id}
                  className={styles.orbit}
                  style={
                    {
                      "--rx": `${p.rx / 12}%`,
                      "--ry": `${p.ry / 6}%`,
                      "--period": `${p.period / 3}s`,
                      "--phase": `${p.phase}deg`,
                    } as CSSProperties
                  }
                >
                  <button
                    type="button"
                    className={styles.planetButton}
                    aria-label={`Dừng chân tại ${p.name}`}
                    onClick={() => onPlanetChange(p.id)}
                  >
                    <span className={styles.whitePlanet} aria-hidden="true">
                      ✦
                    </span>
                    <span className={styles.planetLabel}>{p.name}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
        {planet && <div aria-hidden="true" className={styles.horizon} />}
        {planet && !planetEntries.length && (
          <div className={styles.emptyDestination}>
            <span aria-hidden="true">✦</span>
            <h3>Chưa có tâm tư hiển thị trên {planet.name}</h3>
            <p>Một dòng ngắn cũng có thể trở thành ngôi sao đầu tiên.</p>
            <button type="button" onClick={onCompose}>
              Gửi tâm tư đến {planet.name}
            </button>
          </div>
        )}

        <div className={styles.entryLayer}>
          {planetEntries.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={styles.emotionStar}
              style={location(entry.id)}
              onClick={() => onOpen(entry)}
              aria-label={`Mở ${MOODS[entry.mood]} · ${new Date(entry.createdAt).toLocaleDateString("vi-VN")}`}
            >
              <span aria-hidden="true">✦</span>
            </button>
          ))}
        </div>
        {launch && launch.public === shared && launch.planetId === planetId && (
          <div
            key={launch.sequence}
            className={styles.launch}
            aria-hidden="true"
            onAnimationEnd={(event) => {
              event.currentTarget.style.visibility = "hidden";
            }}
          />
        )}
        {(!planet || planetEntries.length > 0) && (
          <div className={styles.caption}>
            <p>
              {planet
                ? `Một khoảng bình yên trên ${planet.name}`
                : shared
                  ? "Chọn một hành tinh để tìm những vì sao sẻ chia."
                  : "Một hệ hành tinh trắng, cất giữ những điều chỉ thuộc về bạn."}
            </p>
            <small>
              {!planet
                ? "Chạm một hành tinh hoặc chọn nơi dừng chân để mở. Di chuột lên bản đồ để dừng vòng quay."
                : planetEntries.length
                  ? `${planetEntries.length} tâm tư · Chạm vào ngôi sao trắng để mở`
                  : "Hành tinh đang đợi ngôi sao đầu tiên"}
            </small>
          </div>
        )}
      </div>
      <div className={styles.legend}>
        {planet && (
          <button type="button" onClick={() => onPlanetChange("")}>
            ← Về toàn cảnh
          </button>
        )}
        <span>
          <i aria-hidden="true">✦</i>
          {planet
            ? `Những vì sao trên ${planet.name}`
            : "Mỗi hành tinh, một nơi cất giữ"}
        </span>
        <button type="button" onClick={onCompose}>
          Gửi một ánh sao
        </button>
      </div>
    </section>
  );
}
