"use client";

import { useState, type CSSProperties } from "react";
import type { Entry } from "@/lib/types";
import styles from "./universe-scene.module.css";

const PLANETS = [
  {
    id: "mercury",
    name: "Sao Thủy",
    color: "#aca49a",
    size: 10,
    orbit: 16,
    period: 90,
    phase: 20,
  },
  {
    id: "venus",
    name: "Sao Kim",
    color: "#e9c58d",
    size: 15,
    orbit: 25,
    period: 130,
    phase: 155,
  },
  {
    id: "earth",
    name: "Trái Đất",
    color: "#70b9d9",
    size: 18,
    orbit: 35,
    period: 180,
    phase: 280,
  },
  {
    id: "mars",
    name: "Sao Hỏa",
    color: "#c77c63",
    size: 13,
    orbit: 45,
    period: 230,
    phase: 65,
  },
  {
    id: "jupiter",
    name: "Sao Mộc",
    color: "#cda985",
    size: 30,
    orbit: 57,
    period: 310,
    phase: 200,
  },
  {
    id: "saturn",
    name: "Sao Thổ",
    color: "#d5bc8b",
    size: 24,
    orbit: 70,
    period: 400,
    phase: 320,
  },
  {
    id: "uranus",
    name: "Sao Thiên Vương",
    color: "#97cccf",
    size: 19,
    orbit: 83,
    period: 470,
    phase: 110,
  },
  {
    id: "neptune",
    name: "Sao Hải Vương",
    color: "#718bc8",
    size: 18,
    orbit: 96,
    period: 540,
    phase: 235,
  },
];
const MOODS = { joy: "Niềm vui", sadness: "Nỗi buồn", unsaid: "Lời gửi gió" };
const BACKGROUND = Array.from({ length: 100 }, (_, i) => ({
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
  };
}

export default function UniverseScene({
  shared,
  entries,
  onOpen,
  onCompose,
  launch,
}: {
  shared: boolean;
  entries: Entry[];
  onOpen: (entry: Entry) => void;
  onCompose: () => void;
  launch: { sequence: number; public: boolean } | null;
}) {
  const [planetId, setPlanetId] = useState("");
  const [paused, setPaused] = useState(false);
  const planet = shared ? PLANETS.find((p) => p.id === planetId) : undefined;
  return (
    <section
      className={styles.universe}
      aria-label={shared ? "Hệ hành tinh chung" : "Bầu trời riêng"}
    >
      <div className={styles.controls}>
        {shared && (
          <label className={styles.picker}>
            Nơi dừng chân
            <select
              aria-label="Chọn hành tinh"
              value={planetId}
              onChange={(e) => setPlanetId(e.target.value)}
            >
              <option value="">Toàn cảnh hệ hành tinh</option>
              {PLANETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
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
        data-view={planet ? planet.id : shared ? "system" : "personal"}
      >
        <div className={styles.dust} aria-hidden="true" />
        {BACKGROUND.map((p, i) => (
          <i
            key={i}
            aria-hidden="true"
            className={styles.distantStar}
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              animationDelay: `${-i * 0.7}s`,
              width: i % 9 === 0 ? 3 : 1.5,
              height: i % 9 === 0 ? 3 : 1.5,
            }}
          />
        ))}
        {shared && !planet && (
          <div className={styles.system}>
            <div className={styles.sun} aria-label="Mặt Trời" role="img" />
            {PLANETS.map((p) => (
              <div
                key={p.id}
                className={styles.orbit}
                style={
                  {
                    "--orbit": `${p.orbit}%`,
                    "--period": `${p.period}s`,
                    "--phase": `${p.phase}deg`,
                    "--planet-color": p.color,
                    "--size": `${p.size}px`,
                  } as CSSProperties
                }
              >
                <div className={styles.traveler}>
                  <button
                    type="button"
                    className={styles.planetButton}
                    aria-label={`Dừng chân tại ${p.name}`}
                    onClick={() => setPlanetId(p.id)}
                  >
                    <span
                      className={`${styles.planet} ${styles[p.id]}`}
                      aria-hidden="true"
                    />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {planet && (
          <div
            aria-hidden="true"
            className={`${styles.horizon} ${styles[planet.id]}`}
            style={{ "--planet-color": planet.color } as CSSProperties}
          />
        )}
        <div className={styles.entryLayer}>
          {entries.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={`${styles.emotionStar} ${styles[entry.mood]}`}
              style={location(entry.id)}
              onClick={() => onOpen(entry)}
              aria-label={`Mở ${MOODS[entry.mood]} · ${new Date(entry.createdAt).toLocaleDateString("vi-VN")}`}
            >
              <span aria-hidden="true" />
            </button>
          ))}
        </div>
        {launch && launch.public === shared && (
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
                ? "Chọn một nơi dừng chân, để lòng mình trôi giữa những vì sao."
                : "Mỗi cảm xúc đều có một chỗ trên bầu trời này."}
          </p>
          <small>
            {entries.length
              ? "Chạm vào một đốm sáng để mở tâm tư"
              : "Bầu trời đang đợi tâm tư đầu tiên"}
          </small>
        </div>
      </div>
      <div className={styles.legend}>
        {planet && (
          <button type="button" onClick={() => setPlanetId("")}>
            ← Về toàn cảnh
          </button>
        )}
        <span>
          <i className={styles.joy} />
          Niềm vui
        </span>
        <span>
          <i className={styles.sadness} />
          Nỗi buồn
        </span>
        <span>
          <i className={styles.unsaid} />
          Lời gửi gió
        </span>
        <button type="button" onClick={onCompose}>
          Gửi một ánh sao
        </button>
      </div>
    </section>
  );
}
