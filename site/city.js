// A schematic map of the published economy. No simulated financial state lives here.
export const DISTRICTS = [
  {
    id: "compute",
    icon: "⌘",
    color: "#acd9ed",
    x: -3,
    y: -3,
    description:
      "Processing power changes hands. Inspect the agents supplying this market.",
  },
  {
    id: "data",
    icon: "▤",
    color: "#aac6ef",
    x: 0,
    y: -3.7,
    description:
      "Data is a modeled service. Its price emerges from offers and affordable demand.",
  },
  {
    id: "research",
    icon: "✳",
    color: "#bda9f6",
    x: 3,
    y: -3,
    description:
      "Research specialists trade modeled services under the same public rules.",
  },
  {
    id: "code",
    icon: "⌥",
    color: "#ade4bc",
    x: -3.7,
    y: 0,
    description:
      "Code producers compete on price. Follow a seller and inspect their recorded trades.",
  },
  {
    id: "audit",
    icon: "◈",
    color: "#efc799",
    x: 3.7,
    y: 0,
    description:
      "Audit services are one of ten markets. Each transaction leaves a public record.",
  },
  {
    id: "security",
    icon: "◇",
    color: "#ebafab",
    x: -3,
    y: 3,
    description:
      "Security specialists earn and spend inside the same closed experimental economy.",
  },
  {
    id: "planning",
    icon: "⚑",
    color: "#c5d99f",
    x: 0,
    y: 3.7,
    description:
      "Planning agents have individual productivity and spending propensities.",
  },
  {
    id: "design",
    icon: "✧",
    color: "#c6b6dd",
    x: 3,
    y: 3,
    description:
      "Design agents offer services and buy from other districts. Watch the flows connect.",
  },
  {
    id: "verification",
    icon: "✓",
    color: "#99cec4",
    x: -5,
    y: 1.2,
    description:
      "A distinct modeled service market. This district does not validate the protocol itself.",
  },
  {
    id: "storage",
    icon: "▥",
    color: "#dbc79d",
    x: 1.2,
    y: -5,
    description:
      "Storage providers exchange simulated services. All settlement happens in internal units.",
  },
];

export class City {
  constructor(canvas, onSelect) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.onSelect = onSelect;
    this.time = 0;
    this.selected = "compute";
    this.trades = [];
    this.agents = [];
    this.paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.visible = true;
    this.hits = [];
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener("click", (e) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) * this.width) / r.width,
        y = ((e.clientY - r.top) * this.height) / r.height;
      const hit = this.hits.find(
        (h) => Math.abs(h.x - x) < h.w && Math.abs(h.y - y) < h.h,
      );
      if (hit) this.onSelect(hit.id);
    });
    canvas.addEventListener("keydown", (e) => {
      if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter"].includes(
          e.key,
        )
      ) {
        e.preventDefault();
        let i = DISTRICTS.findIndex((d) => d.id === this.selected);
        if (e.key !== "Enter")
          i =
            (i +
              (["ArrowLeft", "ArrowUp"].includes(e.key) ? -1 : 1) +
              DISTRICTS.length) %
            DISTRICTS.length;
        this.onSelect(DISTRICTS[i].id);
      }
      if (e.key === "f") this.fullscreen();
    });
    this.motion = matchMedia("(prefers-reduced-motion: reduce)");
    this.motion.addEventListener("change", () => {
      if (this.motion.matches) {
        this.paused = true;
        document.dispatchEvent(new Event("city-motion-paused"));
      }
      this.draw();
    });
    let last = 0;
    const frame = (t) => {
      if (!this.paused && this.visible && !document.hidden) {
        this.time += Math.min(t - last || 0, 80);
        this.draw();
      }
      last = t;
      this.frame = requestAnimationFrame(frame);
    };
    this.frame = requestAnimationFrame(frame);
  }
  setData(agents, trades) {
    this.agents = agents;
    this.trades = trades;
    this.draw();
  }
  select(id) {
    this.selected = id;
    this.draw();
  }
  async fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.canvas.parentElement.requestFullscreen();
    } catch {
      /* unsupported browsers retain the normal city view */
    }
  }
  project(x, y, z = 0) {
    return [
      this.width / 2 + (x - y) * this.scale,
      this.height * 0.49 + (x + y) * this.scale * 0.49 - z * this.scale,
    ];
  }
  polygon(points, fill, stroke = null) {
    const c = this.ctx;
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 0.8;
      c.stroke();
    }
  }
  tile(x, y, s, z, fill, stroke) {
    this.polygon(
      [
        this.project(x - s, y - s, z),
        this.project(x + s, y - s, z),
        this.project(x + s, y + s, z),
        this.project(x - s, y + s, z),
      ],
      fill,
      stroke,
    );
  }
  box(x, y, s, h, top, left, right, base = 0) {
    const p = (a, b, z) => this.project(a, b, z);
    this.polygon(
      [
        p(x - s, y + s, base),
        p(x + s, y + s, base),
        p(x + s, y + s, h),
        p(x - s, y + s, h),
      ],
      left,
      "#253e49",
    );
    this.polygon(
      [
        p(x + s, y - s, base),
        p(x + s, y + s, base),
        p(x + s, y + s, h),
        p(x + s, y - s, h),
      ],
      right,
      "#253e49",
    );
    this.tile(x, y, s, h, top, "#55727a");
  }
  line(points, color, width = 1) {
    const c = this.ctx;
    c.beginPath();
    points.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.strokeStyle = color;
    c.lineWidth = width;
    c.stroke();
  }
  draw() {
    const c = this.ctx,
      r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = r.width;
    this.height = r.height;
    this.scale = Math.min(r.width / 18, r.height / 11.7);
    const w = Math.round(r.width * dpr),
      h = Math.round(r.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = "#121f27";
    c.fillRect(0, 0, r.width, r.height);
    const glow = c.createRadialGradient(
      r.width * 0.52,
      r.height * 0.53,
      0,
      r.width * 0.5,
      r.height * 0.5,
      r.width * 0.65,
    );
    glow.addColorStop(0, "#23424a66");
    glow.addColorStop(1, "#121f2700");
    c.fillStyle = glow;
    c.fillRect(0, 0, r.width, r.height);
    // Star chart grid and tiny landmarks around a floating island.
    for (let i = 0; i < 65; i++) {
      const x = (i * 173 + 37) % r.width,
        y = (i * 89 + 57) % r.height;
      c.fillStyle = i % 5 === 0 ? "#66808966" : "#48627133";
      c.fillRect(x, y, 1.2, 1.2);
    }
    for (let i = -8; i <= 8; i++) {
      this.line(
        [this.project(i, -8, -0.65), this.project(i, 8, -0.65)],
        "#20333d",
        0.5,
      );
      this.line(
        [this.project(-8, i, -0.65), this.project(8, i, -0.65)],
        "#20333d",
        0.5,
      );
    }
    this.box(0, 0, 5.85, -0.18, "#21363d", "#0b171f", "#10222b", -0.8);
    this.tile(0, 0, 5.85, -0.15, "#1d333a", "#58706b");
    for (let i = -5; i <= 5; i++) {
      this.line(
        [this.project(i, -5.8, -0.12), this.project(i, 5.8, -0.12)],
        "#2d4449",
        0.65,
      );
      this.line(
        [this.project(-5.8, i, -0.12), this.project(5.8, i, -0.12)],
        "#2d4449",
        0.65,
      );
    }
    // Cross-town avenues and illuminated borders.
    [-1.45, 1.45].forEach((v) => {
      this.line(
        [this.project(v, -5.8, -0.1), this.project(v, 5.8, -0.1)],
        "#11252d",
        this.scale * 0.32,
      );
      this.line(
        [this.project(-5.8, v, -0.1), this.project(5.8, v, -0.1)],
        "#11252d",
        this.scale * 0.32,
      );
      this.line(
        [this.project(v, -5.8, -0.09), this.project(v, 5.8, -0.09)],
        "#63796d66",
        0.6,
      );
      this.line(
        [this.project(-5.8, v, -0.09), this.project(5.8, v, -0.09)],
        "#63796d66",
        0.6,
      );
    });
    const routes = this.trades.slice(0, 26);
    const ids = new Map(this.agents.map((a) => [a.agent_id, a.specialty]));
    for (let i = 0; i < routes.length; i++) {
      const tx = routes[i],
        from = DISTRICTS.find((d) => d.id === ids.get(tx.buyer)),
        to = DISTRICTS.find((d) => d.id === ids.get(tx.seller));
      if (!from || !to || from === to) continue;
      const a = this.project(from.x, from.y, 0.08),
        b = this.project(to.x, to.y, 0.08);
      this.line([a, b], `${to.color}19`, 0.8);
      const t = (this.time / 4200 + i * 0.137) % 1;
      const px = a[0] + (b[0] - a[0]) * t,
        py = a[1] + (b[1] - a[1]) * t;
      c.shadowBlur = 7;
      c.shadowColor = to.color;
      c.fillStyle = to.color;
      c.beginPath();
      c.arc(px, py, 1.7, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
    }
    const structures = [
      ...DISTRICTS.map((d, i) => ({ ...d, index: i })),
      { id: "bank", x: 0, y: 0, index: 10, color: "#dbeac0" },
    ].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const d of structures) {
      if (d.id === "bank") {
        this.tile(0, 0, 1.1, 0.04, "#425853", "#748774");
        this.box(0, 0, 0.76, 0.35, "#617267", "#344f4c", "#263d3f");
        this.box(0, 0, 0.52, 1.8, "#c4d5b2", "#758f79", "#4d6f64", 0.35);
        this.box(0, 0, 0.61, 1.92, "#d2dfb9", "#9eaf8e", "#819f80", 1.8);
        for (let j = -1; j <= 1; j++) {
          this.line(
            [
              this.project(j * 0.28, 0.54, 0.5),
              this.project(j * 0.28, 0.54, 1.7),
            ],
            "#bad6aa",
            2,
          );
          this.line(
            [
              this.project(0.54, j * 0.28, 0.5),
              this.project(0.54, j * 0.28, 1.7),
            ],
            "#a4c7a4",
            1.5,
          );
        }
        const p = this.project(0, 0, 2.12);
        c.fillStyle = "#d9ecc6";
        c.font = `${Math.max(8, this.scale * 0.2)}px monospace`;
        c.textAlign = "center";
        c.fillText("THE COUNCIL", p[0], p[1]);
        continue;
      }
      const selected = this.selected === d.id;
      this.tile(
        d.x,
        d.y,
        0.97,
        0.02,
        selected ? "#395047" : "#294048",
        selected ? d.color : "#47616a",
      );
      // District buildings use varying heights, lit windows, rooftop equipment.
      const towerHeight = 0.85 + (d.index % 3) * 0.32;
      this.box(
        d.x - 0.18,
        d.y - 0.16,
        0.48,
        towerHeight,
        "#678084",
        "#354e59",
        "#253f4b",
      );
      this.tile(
        d.x - 0.18,
        d.y - 0.16,
        0.5,
        towerHeight + 0.025,
        d.color + "cc",
        d.color,
      );
      for (let floor = 0.25; floor < towerHeight - 0.08; floor += 0.22) {
        for (let col = -1; col <= 1; col++) {
          const p = this.project(d.x - 0.18 + col * 0.24, d.y + 0.325, floor);
          c.fillStyle = (col + d.index) % 3 === 0 ? "#819797" : d.color;
          c.fillRect(p[0] - 2, p[1] - 1, 3, 2);
          const q = this.project(d.x + 0.305, d.y - 0.16 + col * 0.24, floor);
          c.fillStyle = d.color + "aa";
          c.fillRect(q[0] - 1, q[1] - 1, 2, 2);
        }
      }
      this.box(
        d.x + 0.48,
        d.y + 0.35,
        0.22,
        0.45,
        "#526c6b",
        "#385153",
        "#253e48",
      );
      this.tile(d.x + 0.48, d.y + 0.35, 0.19, 0.46, d.color + "88");
      if (d.index % 2 === 0) {
        this.line(
          [
            this.project(d.x - 0.18, d.y - 0.16, towerHeight),
            this.project(d.x - 0.18, d.y - 0.16, towerHeight + 0.5),
          ],
          "#b3c7bc",
          1.4,
        );
        const tip = this.project(d.x - 0.18, d.y - 0.16, towerHeight + 0.5);
        c.fillStyle = d.color;
        c.beginPath();
        c.arc(tip[0], tip[1], 2, 0, 7);
        c.fill();
      }
      // Ten population markers per district; positional layout is illustrative.
      const population = this.agents.filter(
        (a) => a.specialty === d.id && a.active,
      );
      population.forEach((agent, j) => {
        const ax = d.x - 0.77 + (j % 5) * 0.33,
          ay = d.y + 0.75 + Math.floor(j / 5) * 0.18;
        this.box(ax, ay, 0.043, 0.12, d.color, "#567577", "#3c595e");
      });
    }
    // Labels on top keep market inspection easy even at small viewports.
    this.hits = [];
    for (const d of DISTRICTS) {
      const p = this.project(d.x, d.y + 0.9, -0.07);
      const fontSize = this.width < 500 ? 8 : 10;
      c.font = `500 ${fontSize}px "Space Grotesk",system-ui`;
      const label = d.id.toUpperCase(),
        tw = c.measureText(label).width + 18;
      const selected = d.id === this.selected;
      c.fillStyle = selected ? "#c0e7b5" : "#152730ed";
      c.strokeStyle = selected ? "#dcf6c8" : "#526770";
      c.lineWidth = 0.7;
      c.beginPath();
      c.roundRect(p[0] - tw / 2, p[1] - 7, tw, 18, 3);
      c.fill();
      c.stroke();
      c.fillStyle = selected ? "#1e3627" : "#c4d7d6";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(label, p[0], p[1] + 2);
      this.hits.push({ id: d.id, x: p[0], y: p[1], w: tw / 2 + 4, h: 15 });
      const base = this.project(d.x, d.y, 0.5);
      this.hits.push({
        id: d.id,
        x: base[0],
        y: base[1],
        w: this.scale * 0.8,
        h: this.scale * 0.9,
      });
    }
    c.textBaseline = "alphabetic";
    c.textAlign = "left";
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
  }
}
