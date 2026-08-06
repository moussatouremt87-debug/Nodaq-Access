import { motion } from "framer-motion";
import {
  TrendingUp,
  ShieldCheck,
  FileText,
  CalendarDays,
  ArrowUpRight,
  Zap,
} from "lucide-react";

/* ─── Palette ────────────────────────────────────────────────────────────── */
const BG = "#0C0D11";
const CARD_BG = "#13141A";
const CARD_BORDER = "#1E2030";
const ACCENT = "#C6F135"; // NODAQ neon-green
const ACCENT_DIM = "#8FAF1A";
const TEXT = "#F2F4F8";
const MUTED = "#6B7280";

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function NavLink({ children }: { children: string }) {
  return (
    <a
      href="#"
      style={{ color: MUTED, fontSize: 14 }}
      className="hover:text-white transition-colors"
    >
      {children}
    </a>
  );
}

function Pill({
  children,
  primary,
}: {
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      style={{
        background: primary ? ACCENT : "transparent",
        color: primary ? "#0C0D11" : TEXT,
        border: primary ? "none" : `1px solid ${CARD_BORDER}`,
        borderRadius: 9999,
        padding: "9px 20px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 6,
        transition: "opacity 0.15s",
      }}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span
      style={{
        background: `${ACCENT}18`,
        color: ACCENT,
        border: `1px solid ${ACCENT}30`,
        borderRadius: 9999,
        padding: "3px 12px",
        fontSize: 12,
        fontWeight: 500,
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
        gap: 5,
        height: 56,
        marginTop: 16,
      }}
    >
      {bars.map((h, i) => (
        <motion.div
          key={i}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: h * 0.6, opacity: 1 }}
          transition={{ delay: 0.6 + i * 0.07, duration: 0.5, type: "spring" }}
          style={{
            flex: 1,
            borderRadius: 4,
            background:
              i === bars.length - 1
                ? ACCENT
                : `linear-gradient(to top, ${ACCENT_DIM}60, ${ACCENT_DIM}20)`,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Pulsing dot ────────────────────────────────────────────────────────── */
function PulseDot({ color = ACCENT }: { color?: string }) {
  return (
    <div style={{ position: "relative", width: 10, height: 10 }}>
      <motion.div
        animate={{ scale: [1, 2.2, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 2, repeat: Infinity }}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: color,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 2,
          borderRadius: "50%",
          background: color,
        }}
      />
    </div>
  );
}

/* ─── Stat row ───────────────────────────────────────────────────────────── */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 30,
          fontWeight: 700,
          color: TEXT,
          letterSpacing: "-0.03em",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>{label}</div>
    </div>
  );
}

/* ─── Cards ──────────────────────────────────────────────────────────────── */
interface CardProps {
  delay?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

function Card({ delay = 0, children, style }: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.55, type: "spring", stiffness: 80 }}
      style={{
        background: CARD_BG,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 16,
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
  { name: "Villa Leclerc — Extension", stage: "Devis envoyé", pct: 40 },
  { name: "Rénovation Dupont SCI", stage: "En cours", pct: 70 },
  { name: "Bureaux Kléber", stage: "Facturation", pct: 90 },
];

function PipelineRow({
  name,
  stage,
  pct,
  delay,
}: {
  name: string;
  stage: string;
  pct: number;
  delay: number;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 5,
        }}
      >
        <span style={{ fontSize: 13, color: TEXT, fontWeight: 500 }}>
          {name}
        </span>
        <span style={{ fontSize: 12, color: MUTED }}>{stage}</span>
      </div>
      <div
        style={{
          height: 4,
          borderRadius: 99,
          background: `${ACCENT}18`,
          overflow: "hidden",
        }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ delay: delay + 0.8, duration: 0.8, ease: "easeOut" }}
          style={{ height: "100%", background: ACCENT, borderRadius: 99 }}
        />
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export function NodaqLanding() {
  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        background: BG,
        color: TEXT,
        fontFamily:
          "'Inter', 'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif",
        overflowX: "hidden",
      }}
    >
      {/* ── Nav ── */}
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "20px 60px",
          borderBottom: `1px solid ${CARD_BORDER}`,
          position: "sticky",
          top: 0,
          background: `${BG}e8`,
          backdropFilter: "blur(12px)",
          zIndex: 10,
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: ACCENT,
              display: "grid",
              placeItems: "center",
            }}
          >
            <Zap size={18} color="#0C0D11" strokeWidth={2.5} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: -0.5 }}>
            NODAQ
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: MUTED,
              letterSpacing: 1,
              marginLeft: 2,
            }}
          >
            COCKPIT V1.0
          </span>
        </div>

        {/* Links */}
        <div style={{ display: "flex", gap: 32 }}>
          {["Fonctionnalités", "Tarifs", "Ressources", "À propos"].map((l) => (
            <NavLink key={l}>{l}</NavLink>
          ))}
        </div>

        {/* CTA */}
        <div style={{ display: "flex", gap: 10 }}>
          <Pill>Se connecter</Pill>
          <Pill primary>
            Démarrer gratuitement <ArrowUpRight size={14} />
          </Pill>
        </div>
      </nav>

      {/* ── Hero ── */}
      <div
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          padding: "72px 60px 56px",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 56,
          alignItems: "center",
        }}
      >
        {/* Left */}
        <div>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Badge>✦ Cockpit pour artisans &amp; entreprises du bâtiment</Badge>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.55 }}
            style={{
              fontSize: 52,
              fontWeight: 800,
              lineHeight: 1.07,
              letterSpacing: "-0.04em",
              margin: "24px 0 20px",
              color: TEXT,
            }}
          >
            Pilotez votre activité.
            <br />
            <span style={{ color: ACCENT }}>Sans angle mort.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            style={{
              fontSize: 16,
              color: MUTED,
              lineHeight: 1.65,
              maxWidth: 420,
              margin: "0 0 32px",
            }}
          >
            Devis, chantiers, factures et trésorerie en un seul écran.
            NODAQ remplace cinq outils disparates par un cockpit unique
            conçu pour le terrain.
          </motion.p>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            style={{ display: "flex", gap: 12, marginBottom: 52 }}
          >
            <Pill primary>
              Essayer gratuitement <ArrowUpRight size={14} />
            </Pill>
            <Pill>Voir la démo</Pill>
          </motion.div>

          {/* Stats */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 24,
              paddingTop: 32,
              borderTop: `1px solid ${CARD_BORDER}`,
            }}
          >
            <Stat value="4 800+" label="Artisans actifs" />
            <Stat value="98 M€+" label="Factures traitées" />
            <Stat value="< 3 min" label="Pour créer un devis" />
          </motion.div>
        </div>

        {/* Right — card grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
          }}
        >
          {/* CA card */}
          <Card
            delay={0.15}
            style={{ gridColumn: "span 2", position: "relative", overflow: "hidden" }}
          >
            {/* subtle glow */}
            <div
              style={{
                position: "absolute",
                top: -60,
                right: -60,
                width: 220,
                height: 220,
                borderRadius: "50%",
                background: `${ACCENT}09`,
                filter: "blur(40px)",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
              }}
            >
              <div>
                <div style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>
                  Chiffre d'affaires — Nov 2026
                </div>
                <div
                  style={{
                    fontSize: 32,
                    fontWeight: 700,
                    letterSpacing: "-0.03em",
                  }}
                >
                  48 320 €
                </div>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  color: ACCENT,
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                <TrendingUp size={15} /> +12,4 %
              </div>
            </div>
            <MiniChart />
          </Card>

          {/* Pipeline card */}
          <Card delay={0.25} style={{ gridColumn: "span 2" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 18,
              }}
            >
              <div style={{ fontSize: 13, color: MUTED }}>
                Affaires en cours
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: ACCENT,
                  fontWeight: 500,
                }}
              >
                <PulseDot /> 3 actives
              </div>
            </div>
            {AFFAIRES.map((a, i) => (
              <PipelineRow key={i} {...a} delay={i * 0.08} />
            ))}
          </Card>

          {/* Trésorerie card */}
          <Card delay={0.35}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: `${ACCENT}15`,
                display: "grid",
                placeItems: "center",
                marginBottom: 14,
              }}
            >
              <ShieldCheck size={18} color={ACCENT} />
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>
              Solde trésorerie
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "-0.025em",
              }}
            >
              12 450 €
            </div>
            <div style={{ fontSize: 11, color: ACCENT, marginTop: 4 }}>
              Synchronisé en temps réel
            </div>
          </Card>

          {/* Factures card */}
          <Card delay={0.4}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: `${ACCENT}15`,
                display: "grid",
                placeItems: "center",
                marginBottom: 14,
              }}
            >
              <FileText size={18} color={ACCENT} />
            </div>
            <div style={{ fontSize: 12, color: MUTED, marginBottom: 4 }}>
              Factures ce mois
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: "-0.025em",
              }}
            >
              7 émises
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
              2 en attente de règlement
            </div>
          </Card>
        </div>
      </div>

      {/* ── Feature strip ── */}
      <div
        style={{
          borderTop: `1px solid ${CARD_BORDER}`,
          padding: "32px 60px",
          display: "flex",
          justifyContent: "center",
          gap: 48,
          flexWrap: "wrap",
        }}
      >
        {[
          { icon: CalendarDays, label: "Planning Gantt" },
          { icon: FileText, label: "Devis & Factures" },
          { icon: TrendingUp, label: "Compte de résultat" },
          { icon: ShieldCheck, label: "Trésorerie Open Banking" },
        ].map(({ icon: Icon, label }) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: MUTED,
              fontSize: 14,
            }}
          >
            <Icon size={16} color={ACCENT} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
