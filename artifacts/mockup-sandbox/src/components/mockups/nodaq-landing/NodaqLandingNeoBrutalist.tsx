import { motion } from "framer-motion";
import {
  TrendingUp,
  ShieldCheck,
  FileText,
  CalendarDays,
  ArrowRight,
  Hammer,
} from "lucide-react";
import "./nodaq-landing-neo-brutalist.css";

/* ─── Palette (also in CSS vars) ─────────────────────────────────────────── */
const ACCENT = "#FF4A1C"; // Safety Orange
const ACCENT_2 = "#FFD600"; // High-vis Yellow
const ACCENT_3 = "#B288FF"; // Electric Purple
const BORDER = "#000000";

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function NavLink({ children }: { children: string }) {
  return (
    <a
      href="#"
      style={{ color: "#000", fontSize: 15, fontWeight: 700 }}
      className="hover:underline neo-font-body decoration-2 underline-offset-4"
    >
      {children}
    </a>
  );
}

function Pill({
  children,
  primary,
  color = ACCENT,
}: {
  children: React.ReactNode;
  primary?: boolean;
  color?: string;
}) {
  return (
    <button
      className="neo-font-body neo-button-hover neo-shadow-sm"
      style={{
        background: primary ? color : "#FFFFFF",
        color: "#000000",
        border: `3px solid ${BORDER}`,
        borderRadius: 0,
        padding: "12px 24px",
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 10,
        textTransform: "uppercase",
      }}
    >
      {children}
    </button>
  );
}

function Badge({ children, bg = ACCENT_2 }: { children: string; bg?: string }) {
  return (
    <span
      className="neo-font-body neo-shadow-sm"
      style={{
        background: bg,
        color: "#000000",
        border: `3px solid ${BORDER}`,
        borderRadius: 0,
        padding: "6px 16px",
        fontSize: 13,
        fontWeight: 700,
        textTransform: "uppercase",
        display: "inline-block",
      }}
    >
      {children}
    </span>
  );
}

/* ─── Animated bar mini-chart ────────────────────────────────────────────── */
function MiniChart() {
  const bars = [28, 45, 38, 72, 58, 90, 65];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 8,
        height: 70,
        marginTop: 20,
      }}
    >
      {bars.map((h, i) => (
        <motion.div
          key={i}
          initial={{ height: 0 }}
          animate={{ height: h * 0.7 }}
          transition={{
            delay: 0.6 + i * 0.05,
            duration: 0.4,
            type: "spring",
            stiffness: 200,
            damping: 12,
          }}
          style={{
            flex: 1,
            background: i === bars.length - 1 ? ACCENT : "#FFFFFF",
            border: `3px solid ${BORDER}`,
            borderBottom: "none",
            transformOrigin: "bottom",
          }}
        />
      ))}
    </div>
  );
}

/* ─── Pulsing dot ────────────────────────────────────────────────────────── */
function PulseDot({ color = ACCENT }: { color?: string }) {
  return (
    <div style={{ position: "relative", width: 12, height: 12 }}>
      <motion.div
        animate={{ scale: [1, 1.8, 1], opacity: [1, 0, 1] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
        style={{
          position: "absolute",
          inset: 0,
          background: color,
          border: `2px solid ${BORDER}`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: color,
          border: `2px solid ${BORDER}`,
        }}
      />
    </div>
  );
}

/* ─── Stat row ───────────────────────────────────────────────────────────── */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div style={{ background: "#FFFFFF", border: `3px solid ${BORDER}`, padding: "16px" }} className="neo-shadow-sm">
      <div
        className="neo-font-heading"
        style={{
          fontSize: 36,
          fontWeight: 700,
          color: "#000",
          letterSpacing: "-0.03em",
        }}
      >
        {value}
      </div>
      <div className="neo-font-body" style={{ fontSize: 13, color: "#000", marginTop: 4, fontWeight: 700, textTransform: "uppercase" }}>
        {label}
      </div>
    </div>
  );
}

/* ─── Cards ──────────────────────────────────────────────────────────────── */
interface CardProps {
  delay?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
  bg?: string;
}

function Card({ delay = 0, children, style, bg = "#FFFFFF" }: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, rotate: -2 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{
        delay,
        duration: 0.5,
        type: "spring",
        stiffness: 100,
        damping: 15,
      }}
      className="neo-shadow-lg"
      style={{
        background: bg,
        border: `3px solid ${BORDER}`,
        padding: 24,
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

/* ─── Pipeline rows ──────────────────────────────────────────────────────── */
const AFFAIRES = [
  { name: "VILLA LECLERC — EXT", stage: "DEVIS", pct: 40, color: ACCENT_2 },
  { name: "RENO DUPONT SCI", stage: "EN COURS", pct: 70, color: ACCENT },
  { name: "BUREAUX KLÉBER", stage: "FACTURE", pct: 90, color: ACCENT_3 },
];

function PipelineRow({
  name,
  stage,
  pct,
  delay,
  color,
}: {
  name: string;
  stage: string;
  pct: number;
  delay: number;
  color: string;
}) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span className="neo-font-heading" style={{ fontSize: 16, color: "#000", fontWeight: 700 }}>
          {name}
        </span>
        <span className="neo-font-body" style={{ fontSize: 12, color: "#000", fontWeight: 700, background: "#FFF", border: `2px solid ${BORDER}`, padding: "2px 8px" }}>
          {stage}
        </span>
      </div>
      <div
        style={{
          height: 16,
          background: "#FFFFFF",
          border: `3px solid ${BORDER}`,
          position: "relative",
        }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ delay: delay + 0.6, duration: 0.8, type: "spring" }}
          style={{
            height: "100%",
            background: color,
            borderRight: `3px solid ${BORDER}`,
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
          }}
        />
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export function NodaqLandingNeoBrutalist() {
  return (
    <div
      className="neo-bg-pattern neo-root"
      style={{
        minHeight: "100vh",
        width: "100%",
        color: "#000000",
        overflowX: "hidden",
        position: "relative",
      }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto", position: "relative" }}>
        {/* ── Nav ── */}
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "24px 60px",
            borderBottom: `4px solid ${BORDER}`,
            background: "#FFFFFF",
            position: "sticky",
            top: 0,
            zIndex: 50,
          }}
        >
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              className="neo-shadow-sm"
              style={{
                width: 48,
                height: 48,
                background: ACCENT,
                border: `3px solid ${BORDER}`,
                display: "grid",
                placeItems: "center",
              }}
            >
              <Hammer size={24} color="#000000" strokeWidth={3} />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span
                className="neo-font-heading"
                style={{ fontWeight: 800, fontSize: 28, lineHeight: 1, letterSpacing: "-0.04em", textTransform: "uppercase" }}
              >
                Nodaq
              </span>
              <span
                className="neo-font-body"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 2,
                  marginTop: 2,
                }}
              >
                ARTISAN
              </span>
            </div>
          </div>

          {/* Links */}
          <div style={{ display: "flex", gap: 48 }}>
            {["Le Cockpit", "Notre Approche", "Témoignages", "Tarifs"].map(
              (l) => (
                <NavLink key={l}>{l}</NavLink>
              )
            )}
          </div>

          {/* CTA */}
          <div style={{ display: "flex", gap: 16 }}>
            <Pill color="#EAE6DF">Connexion</Pill>
            <Pill primary color={ACCENT_2}>
              Essai Gratuit <ArrowRight size={18} strokeWidth={3} />
            </Pill>
          </div>
        </nav>

        {/* ── Hero ── */}
        <div
          style={{
            padding: "80px 60px 100px",
            display: "grid",
            gridTemplateColumns: "1.1fr 0.9fr",
            gap: 64,
            alignItems: "center",
          }}
        >
          {/* Left */}
          <div>
            <motion.div
              initial={{ opacity: 0, x: -40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, type: "spring", stiffness: 100 }}
            >
              <Badge bg={ACCENT_3}>!!! L'outil des maîtres d'œuvre</Badge>
            </motion.div>

            <motion.h1
              className="neo-font-heading"
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.1,
                duration: 0.6,
                type: "spring",
                stiffness: 100,
              }}
              style={{
                fontSize: 72,
                fontWeight: 800,
                lineHeight: 1,
                letterSpacing: "-0.04em",
                margin: "40px 0 32px",
                textTransform: "uppercase",
              }}
            >
              L'artisanat <br />
              <span style={{ 
                background: ACCENT_2, 
                padding: "0 8px", 
                border: `4px solid ${BORDER}`,
                display: "inline-block",
                transform: "rotate(-2deg)",
                marginTop: 12
              }}>
                exige de la
              </span>
              <br />
              <span style={{ 
                background: ACCENT, 
                padding: "0 8px", 
                border: `4px solid ${BORDER}`,
                display: "inline-block",
                transform: "rotate(1deg)",
                marginTop: 12,
                color: "#FFF"
              }}>
                précision.
              </span>
            </motion.h1>

            <motion.p
              className="neo-font-body"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              style={{
                fontSize: 18,
                fontWeight: 600,
                lineHeight: 1.6,
                maxWidth: 500,
                margin: "0 0 48px",
                padding: "16px",
                background: "#FFFFFF",
                border: `3px solid ${BORDER}`,
                boxShadow: `4px 4px 0px ${BORDER}`
              }}
            >
              Chantiers, devis, facturation et trésorerie réunis dans un espace
              clair et brutalement efficace. Vous bâtissez, nous organisons.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              style={{ display: "flex", gap: 20, marginBottom: 72 }}
            >
              <Pill primary color={ACCENT}>
                Ouvrir mon espace <ArrowRight size={18} strokeWidth={3} />
              </Pill>
              <Pill color="#FFFFFF">Découvrir</Pill>
            </motion.div>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 24,
              }}
            >
              <Stat value="4.8K" label="Artisans" />
              <Stat value="98M€" label="Volume" />
              <Stat value="ZERO" label="Papier" />
            </motion.div>
          </div>

          {/* Right — card grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 32,
            }}
          >
            {/* CA card */}
            <Card
              delay={0.2}
              bg="#FFFFFF"
              style={{
                gridColumn: "span 2",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                }}
              >
                <div>
                  <div
                    className="neo-font-body"
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      marginBottom: 12,
                      textTransform: "uppercase",
                    }}
                  >
                    CA — Nov 2026
                  </div>
                  <div
                    className="neo-font-heading"
                    style={{
                      fontSize: 48,
                      fontWeight: 800,
                      letterSpacing: "-0.04em",
                    }}
                  >
                    48 320 €
                  </div>
                </div>
                <div
                  className="neo-font-body neo-shadow-sm"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 14,
                    fontWeight: 700,
                    background: ACCENT_2,
                    border: `3px solid ${BORDER}`,
                    padding: "8px 16px",
                  }}
                >
                  <TrendingUp size={18} strokeWidth={3} /> +12,4%
                </div>
              </div>
              <MiniChart />
            </Card>

            {/* Pipeline card */}
            <Card delay={0.3} style={{ gridColumn: "span 2" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 32,
                  paddingBottom: 16,
                  borderBottom: `3px solid ${BORDER}`
                }}
              >
                <div
                  className="neo-font-heading"
                  style={{ fontSize: 24, fontWeight: 800, textTransform: "uppercase" }}
                >
                  Chantiers
                </div>
                <div
                  className="neo-font-body neo-shadow-sm"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    fontSize: 14,
                    fontWeight: 700,
                    background: ACCENT_3,
                    border: `3px solid ${BORDER}`,
                    padding: "8px 16px",
                  }}
                >
                  <PulseDot color="#FFFFFF" /> 3 ACTIFS
                </div>
              </div>
              {AFFAIRES.map((a, i) => (
                <PipelineRow key={i} {...a} delay={i * 0.1} />
              ))}
            </Card>

            {/* Trésorerie card */}
            <Card delay={0.4} bg={ACCENT_2}>
              <div
                className="neo-shadow-sm"
                style={{
                  width: 56,
                  height: 56,
                  background: "#FFFFFF",
                  border: `3px solid ${BORDER}`,
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 24,
                }}
              >
                <ShieldCheck size={28} color="#000" strokeWidth={2.5} />
              </div>
              <div
                className="neo-font-body"
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  marginBottom: 8,
                  textTransform: "uppercase"
                }}
              >
                Trésorerie
              </div>
              <div
                className="neo-font-heading"
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                }}
              >
                12 450 €
              </div>
            </Card>

            {/* Factures card */}
            <Card delay={0.5} bg="#FFFFFF">
              <div
                className="neo-shadow-sm"
                style={{
                  width: 56,
                  height: 56,
                  background: ACCENT_3,
                  border: `3px solid ${BORDER}`,
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 24,
                }}
              >
                <FileText size={28} color="#000" strokeWidth={2.5} />
              </div>
              <div
                className="neo-font-body"
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  marginBottom: 8,
                  textTransform: "uppercase"
                }}
              >
                Factures
              </div>
              <div
                className="neo-font-heading"
                style={{
                  fontSize: 32,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                }}
              >
                7 ÉMISES
              </div>
              <div
                className="neo-font-body"
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  marginTop: 12,
                  background: ACCENT,
                  color: "#FFF",
                  padding: "4px 8px",
                  display: "inline-block",
                  border: `2px solid ${BORDER}`
                }}
              >
                2 EN ATTENTE
              </div>
            </Card>
          </div>
        </div>

        {/* ── Feature strip ── */}
        <div
          className="neo-font-body"
          style={{
            borderTop: `4px solid ${BORDER}`,
            background: "#FFFFFF",
            padding: "32px 60px",
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 24,
          }}
        >
          {[
            { icon: CalendarDays, label: "PLANNING" },
            { icon: FileText, label: "DEVIS & FACTURES" },
            { icon: TrendingUp, label: "RENTABILITÉ" },
            { icon: ShieldCheck, label: "BANQUE" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                fontSize: 16,
                fontWeight: 700,
                border: `3px solid ${BORDER}`,
                padding: "12px 24px",
                background: "#EAE6DF",
                boxShadow: `4px 4px 0px ${BORDER}`
              }}
            >
              <Icon size={24} color={ACCENT} strokeWidth={2.5} />
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
