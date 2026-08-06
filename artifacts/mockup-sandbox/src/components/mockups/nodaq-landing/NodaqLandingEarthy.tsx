import { motion } from "framer-motion";
import {
  TrendingUp,
  ShieldCheck,
  FileText,
  CalendarDays,
  ArrowRight,
  Hammer,
} from "lucide-react";
import "./nodaq-landing-earthy.css";

/* ─── Palette ────────────────────────────────────────────────────────────── */
const BG = "#F9F8F6";
const CARD_BG = "#FFFFFF";
const CARD_BORDER = "#EAE8E2";
const ACCENT = "#BC5133"; // Terracotta
const ACCENT_DIM = "#EAB5A4";
const TEXT = "#292724";
const MUTED = "#87817A";

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function NavLink({ children }: { children: string }) {
  return (
    <a
      href="#"
      style={{ color: MUTED, fontSize: 14, fontWeight: 500 }}
      className="hover:text-[#292724] transition-colors font-body"
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
      className="font-body"
      style={{
        background: primary ? ACCENT : "transparent",
        color: primary ? "#FFFFFF" : TEXT,
        border: primary ? "1px solid transparent" : `1px solid ${CARD_BORDER}`,
        borderRadius: 8,
        padding: "10px 22px",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 8,
        transition: "all 0.2s ease",
        boxShadow: primary ? "0 4px 14px rgba(188, 81, 51, 0.25)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span
      className="font-body"
      style={{
        background: "#F2EBE5",
        color: ACCENT,
        border: `1px solid #E8DDD5`,
        borderRadius: 6,
        padding: "5px 14px",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.02em",
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
        gap: 6,
        height: 60,
        marginTop: 18,
      }}
    >
      {bars.map((h, i) => (
        <motion.div
          key={i}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: h * 0.6, opacity: 1 }}
          transition={{ delay: 0.6 + i * 0.07, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          style={{
            flex: 1,
            borderRadius: "4px 4px 0 0",
            background: i === bars.length - 1 ? ACCENT : ACCENT_DIM,
            opacity: i === bars.length - 1 ? 1 : 0.5,
          }}
        />
      ))}
    </div>
  );
}

/* ─── Pulsing dot ────────────────────────────────────────────────────────── */
function PulseDot({ color = ACCENT }: { color?: string }) {
  return (
    <div style={{ position: "relative", width: 8, height: 8 }}>
      <motion.div
        animate={{ scale: [1, 2.5, 1], opacity: [0.5, 0, 0.5] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
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
          inset: 1,
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
        className="font-heading"
        style={{
          fontSize: 34,
          fontWeight: 500,
          color: TEXT,
          letterSpacing: "-0.01em",
        }}
      >
        {value}
      </div>
      <div className="font-body" style={{ fontSize: 13, color: MUTED, marginTop: 6, fontWeight: 500 }}>
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
}

function Card({ delay = 0, children, style }: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      style={{
        background: CARD_BG,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 12,
        padding: 24,
        boxShadow: "0 8px 30px rgba(41, 39, 36, 0.04)",
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
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 8,
        }}
      >
        <span className="font-body" style={{ fontSize: 13, color: TEXT, fontWeight: 600 }}>
          {name}
        </span>
        <span className="font-body" style={{ fontSize: 12, color: MUTED, fontWeight: 500 }}>
          {stage}
        </span>
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 3,
          background: "#F2EBE5",
          overflow: "hidden",
        }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ delay: delay + 0.8, duration: 1, ease: [0.16, 1, 0.3, 1] }}
          style={{ height: "100%", background: ACCENT, borderRadius: 3 }}
        />
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export function NodaqLandingEarthy() {
  return (
    <div
      className="earthy-bg-noise"
      style={{
        minHeight: "100vh",
        width: "100%",
        background: BG,
        color: TEXT,
        overflowX: "hidden",
      }}
    >
      <div className="earthy-content-wrapper">
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
            background: `rgba(249, 248, 246, 0.85)`,
            backdropFilter: "blur(12px)",
            zIndex: 10,
          }}
        >
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                background: ACCENT,
                display: "grid",
                placeItems: "center",
                boxShadow: "0 2px 10px rgba(188, 81, 51, 0.25)",
              }}
            >
              <Hammer size={18} color="#FFFFFF" strokeWidth={2.5} />
            </div>
            <span
              className="font-heading"
              style={{ fontWeight: 600, fontSize: 22, letterSpacing: "-0.02em" }}
            >
              Nodaq.
            </span>
            <span
              className="font-body"
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: MUTED,
                letterSpacing: 1.5,
                marginLeft: 4,
                marginTop: 4,
              }}
            >
              ARTISAN
            </span>
          </div>

          {/* Links */}
          <div style={{ display: "flex", gap: 40 }}>
            {["Le Cockpit", "Notre Approche", "Témoignages", "Tarifs"].map(
              (l) => (
                <NavLink key={l}>{l}</NavLink>
              )
            )}
          </div>

          {/* CTA */}
          <div style={{ display: "flex", gap: 14 }}>
            <Pill>Connexion</Pill>
            <Pill primary>
              Démarrer un essai <ArrowRight size={14} />
            </Pill>
          </div>
        </nav>

        {/* ── Hero ── */}
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            padding: "88px 60px 72px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 72,
            alignItems: "center",
          }}
        >
          {/* Left */}
          <div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            >
              <Badge>✦ L'outil des maîtres d'œuvre</Badge>
            </motion.div>

            <motion.h1
              className="font-heading"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.1,
                duration: 0.7,
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{
                fontSize: 60,
                fontWeight: 500,
                lineHeight: 1.1,
                letterSpacing: "-0.02em",
                margin: "32px 0 28px",
                color: TEXT,
              }}
            >
              L'artisanat exige <br />
              <span style={{ color: ACCENT, fontStyle: "italic" }}>
                de la précision.
              </span>
            </motion.h1>

            <motion.p
              className="font-body"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.2,
                duration: 0.7,
                ease: [0.16, 1, 0.3, 1],
              }}
              style={{
                fontSize: 17,
                color: MUTED,
                lineHeight: 1.6,
                maxWidth: 460,
                margin: "0 0 40px",
              }}
            >
              Chantiers, devis, facturation et trésorerie réunis dans un espace
              clair et serein. Concentrez-vous sur votre métier, nous organisons
              le reste.
            </motion.p>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3 }}
              style={{ display: "flex", gap: 16, marginBottom: 64 }}
            >
              <Pill primary>
                Ouvrir mon espace <ArrowRight size={14} />
              </Pill>
              <Pill>Découvrir l'approche</Pill>
            </motion.div>

            {/* Stats */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45 }}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 32,
                paddingTop: 40,
                borderTop: `1px solid ${CARD_BORDER}`,
              }}
            >
              <Stat value="4.8k" label="Artisans équipés" />
              <Stat value="98M€" label="Volume géré" />
              <Stat value="Zéro" label="Papier perdu" />
            </motion.div>
          </div>

          {/* Right — card grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 20,
            }}
          >
            {/* CA card */}
            <Card
              delay={0.15}
              style={{
                gridColumn: "span 2",
                position: "relative",
                overflow: "hidden",
              }}
            >
              {/* subtle warm glow */}
              <div
                style={{
                  position: "absolute",
                  top: -100,
                  right: -100,
                  width: 300,
                  height: 300,
                  borderRadius: "50%",
                  background: `radial-gradient(circle, rgba(188,81,51,0.06) 0%, rgba(255,255,255,0) 70%)`,
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
                  <div
                    className="font-body"
                    style={{
                      fontSize: 13,
                      color: MUTED,
                      marginBottom: 8,
                      fontWeight: 500,
                    }}
                  >
                    Chiffre d'affaires — Nov 2026
                  </div>
                  <div
                    className="font-heading"
                    style={{
                      fontSize: 38,
                      fontWeight: 500,
                      letterSpacing: "-0.02em",
                    }}
                  >
                    48 320 €
                  </div>
                </div>
                <div
                  className="font-body"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: ACCENT,
                    fontSize: 13,
                    fontWeight: 600,
                    background: "#FFF4F0",
                    padding: "6px 12px",
                    borderRadius: 6,
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
                  marginBottom: 26,
                }}
              >
                <div
                  className="font-heading"
                  style={{ fontSize: 20, color: TEXT, fontWeight: 500 }}
                >
                  Chantiers en cours
                </div>
                <div
                  className="font-body"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12,
                    color: ACCENT,
                    fontWeight: 600,
                    background: "#FFF4F0",
                    padding: "6px 12px",
                    borderRadius: 6,
                  }}
                >
                  <PulseDot /> 3 actifs
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
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: "#FFF4F0",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 18,
                  border: "1px solid #FADED5",
                }}
              >
                <ShieldCheck size={20} color={ACCENT} />
              </div>
              <div
                className="font-body"
                style={{
                  fontSize: 13,
                  color: MUTED,
                  marginBottom: 4,
                  fontWeight: 500,
                }}
              >
                Solde trésorerie
              </div>
              <div
                className="font-heading"
                style={{
                  fontSize: 26,
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                }}
              >
                12 450 €
              </div>
              <div
                className="font-body"
                style={{
                  fontSize: 12,
                  color: ACCENT,
                  marginTop: 6,
                  fontWeight: 500,
                }}
              >
                Synchronisé à l'instant
              </div>
            </Card>

            {/* Factures card */}
            <Card delay={0.4}>
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: "#F5F4F0",
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 18,
                  border: `1px solid ${CARD_BORDER}`,
                }}
              >
                <FileText size={20} color={TEXT} />
              </div>
              <div
                className="font-body"
                style={{
                  fontSize: 13,
                  color: MUTED,
                  marginBottom: 4,
                  fontWeight: 500,
                }}
              >
                Factures du mois
              </div>
              <div
                className="font-heading"
                style={{
                  fontSize: 26,
                  fontWeight: 500,
                  letterSpacing: "-0.01em",
                }}
              >
                7 émises
              </div>
              <div
                className="font-body"
                style={{
                  fontSize: 12,
                  color: MUTED,
                  marginTop: 6,
                  fontWeight: 500,
                }}
              >
                2 en attente de paiement
              </div>
            </Card>
          </div>
        </div>

        {/* ── Feature strip ── */}
        <div
          className="font-body"
          style={{
            borderTop: `1px solid ${CARD_BORDER}`,
            padding: "48px 60px",
            display: "flex",
            justifyContent: "center",
            gap: 72,
            flexWrap: "wrap",
          }}
        >
          {[
            { icon: CalendarDays, label: "Planning de chantier" },
            { icon: FileText, label: "Édition de devis" },
            { icon: TrendingUp, label: "Suivi de rentabilité" },
            { icon: ShieldCheck, label: "Connexion bancaire" },
          ].map(({ icon: Icon, label }) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                color: TEXT,
                fontSize: 15,
                fontWeight: 500,
              }}
            >
              <Icon size={18} color={ACCENT} strokeWidth={1.5} />
              {label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
