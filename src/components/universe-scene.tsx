"use client";

import { useState, type CSSProperties } from "react";
import type { Entry } from "@/lib/types";
import { PLANETS, type PlanetId } from "@/lib/planets";
import styles from "./universe-scene.module.css";

const MOODS = { joy: "Niềm vui", sadness: "Nỗi buồn", unsaid: "Lời gửi gió" };
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
  const planet = PLANETS.find((p) => p.id === planetId);
  const planetEntries = planet
    ? entries.filter((e) => e.planetId === planet.id)
    : [];
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
            className={`${styles.system} ${!shared ? styles.privateSystem : ""}`}
          >
            <div
              className={styles.sun}
              aria-label={shared ? "Mặt Trời" : "Tâm hệ hành tinh riêng"}
              role="img"
            />
            {PLANETS.map((p) => (
              <div
                key={p.id}
                className={styles.orbit}
                style={
                  {
                    "--orbit": `${p.orbit}%`,
                    "--period": `${p.period}s`,
                    "--phase": `${p.phase}deg`,
                    "--planet-color": shared ? p.color : "#ffffff",
                    "--size": `${p.size}px`,
                  } as CSSProperties
                }
              >
                <div className={styles.traveler}>
                  <button
                    type="button"
                    className={styles.planetButton}
                    aria-label={`Dừng chân tại ${p.name}`}
                    onClick={() => onPlanetChange(p.id)}
                  >
                    <span
                      className={`${styles.planet} ${shared ? styles[p.id] : styles.whitePlanet}`}
                      aria-hidden="true"
                    />
                    <span className={styles.planetLabel}>{p.name}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {planet && (
          <div
            aria-hidden="true"
            className={`${styles.horizon} ${shared ? styles[planet.id] : styles.whiteHorizon}`}
            style={
              {
                "--planet-color": shared ? planet.color : "#e6edff",
              } as CSSProperties
            }
          />
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
              ? "Tâm tư chỉ hiện khi bạn mở hành tinh đã gửi."
              : planetEntries.length
                ? `${planetEntries.length} tâm tư · Chạm vào ngôi sao trắng để mở`
                : "Hành tinh đang đợi ngôi sao đầu tiên"}
          </small>
        </div>
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
