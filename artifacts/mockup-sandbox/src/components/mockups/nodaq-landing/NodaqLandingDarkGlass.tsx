import React, { type ReactNode } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import {
  TrendingUp,
  ShieldCheck,
  FileText,
  CalendarDays,
  ArrowRight,
  Hexagon,
  Sparkles,
  Activity
} from "lucide-react";
import "./nodaq-landing-dark-glass.css";

/* ─── Palette (for inline uses if needed) ────────────────────────────────── */
const NEON_CYAN = "var(--neon-cyan)";
const NEON_PINK = "var(--neon-pink)";
const NEON_PURPLE = "var(--neon-purple)";
const TEXT_MUTED = "var(--text-muted)";

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function NavLink({ children }: { children: string }) {
  return (
    <a
      href="#"
      style={{ color: TEXT_MUTED, fontSize: 14, fontWeight: 500, transition: "color 0.2s" }}
      className="hover:text-white"
    >
      {children}
    </a>
  );
}

function Pill({
  children,
  primary,
}: {
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <button className={`glass-pill ${primary ? "primary" : ""}`}>
      {children}
    </button>
  );
}

function Badge({ children, icon: Icon }: { children: ReactNode; icon?: any }) {
  return (
    <span
      style={{
        background: "rgba(0, 240, 255, 0.05)",
        color: NEON_CYAN,
        border: `1px solid rgba(0, 240, 255, 0.2)`,
        borderRadius: 9999,
        padding: "6px 14px",
        fontSize: 12,
        fontWeight: 600,
        textTransform: "uppercase",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        letterSpacing: "0.05em",
        boxShadow: "0 0 10px rgba(0,240,255,0.1)"
      }}
    >
      {Icon && <Icon size={14} />}
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
        height: 60,
        marginTop: 24,
      }}
    >
      {bars.map((h, i) => (
        <motion.div
          key={i}
          initial={{ height: 0 }}
          animate={{ height: h * 0.6 }}
          transition={{
            delay: 0.6 + i * 0.05,
            duration: 0.6,
            type: "spring",
            damping: 14,
          }}
          style={{
            flex: 1,
            background: i === bars.length - 1 
              ? `linear-gradient(to top, ${NEON_CYAN}, rgba(0,240,255,0.1))` 
              : "rgba(255,255,255,0.05)",
            borderRadius: "4px 4px 0 0",
            transformOrigin: "bottom",
            boxShadow: i === bars.length - 1 ? `0 0 15px rgba(0,240,255,0.3)` : "none",
            borderTop: i === bars.length - 1 ? `1px solid ${NEON_CYAN}` : "1px solid rgba(255,255,255,0.1)"
          }}
        />
      ))}
    </div>
  );
}

/* ─── Pulsing dot ────────────────────────────────────────────────────────── */
function PulseDot({ color = NEON_CYAN }: { color?: string }) {
  return (
    <div style={{ position: "relative", width: 8, height: 8 }}>
      <motion.div
        animate={{ scale: [1, 2.5, 1], opacity: [0.8, 0, 0.8] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute",
          inset: 0,
          background: color,
          borderRadius: "50%",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: color,
          borderRadius: "50%",
          boxShadow: `0 0 8px ${color}`
        }}
      />
    </div>
  );
}

/* ─── Stat row ───────────────────────────────────────────────────────────── */
function Stat({ value, label, delay = 0 }: { value: string; label: string; delay?: number }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      className="glass-panel" 
      style={{ padding: "20px 24px" }}
    >
      <div
        className="dark-glass-heading"
        style={{
          fontSize: 36,
          fontWeight: 700,
          color: "#FFF",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 13, color: TEXT_MUTED, marginTop: 4, fontWeight: 500, letterSpacing: "0.02em" }}>
        {label}
      </div>
    </motion.div>
  );
}

/* ─── Cards ──────────────────────────────────────────────────────────────── */
interface CardProps {
  delay?: number;
  children: ReactNode;
  style?: React.CSSProperties;
  className?: string;
}

function Card({ delay = 0, children, style, className = "" }: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay,
        duration: 0.7,
        type: "spring",
        damping: 20,
      }}
      className={`glass-panel ${className}`}
      style={{
        padding: 28,
        ...style,
      }}
    >
      {children}
    </motion.div>
  );
}

/* ─── Pipeline rows ──────────────────────────────────────────────────────── */
const AFFAIRES = [
  { name: "Villa Leclerc — Ext", stage: "Devis", pct: 40, color: NEON_CYAN },
  { name: "Reno Dupont SCI", stage: "En cours", pct: 70, color: NEON_PINK },
  { name: "Bureaux Kléber", stage: "Facturé", pct: 90, color: NEON_PURPLE },
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
        <span className="dark-glass-heading" style={{ fontSize: 16, color: "#FFF", fontWeight: 500 }}>
          {name}
        </span>
        <span style={{ 
          fontSize: 12, 
          color: color, 
          fontWeight: 600,
          background: `rgba(255,255,255,0.03)`,
          padding: "2px 8px",
          borderRadius: 4,
          border: `1px solid rgba(255,255,255,0.05)`
        }}>
          {stage}
        </span>
      </div>
      <div
        style={{
          height: 6,
          background: "rgba(255,255,255,0.05)",
          borderRadius: 4,
          position: "relative",
          overflow: "hidden"
        }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ delay: delay + 0.6, duration: 1.2, type: "spring", damping: 15 }}
          style={{
            height: "100%",
            background: color,
            borderRadius: 4,
            position: "absolute",
            top: 0,
            left: 0,
            bottom: 0,
            boxShadow: `0 0 10px ${color}`
          }}
        />
      </div>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export function NodaqLandingDarkGlass() {
  const { scrollY } = useScroll();
  const y1 = useTransform(scrollY, [0, 1000], [0, 200]);

  return (
    <div className="dark-glass-root">
      <div className="glass-noise" />
      
      {/* 3D Background Elements - generated image */}
      <motion.img 
        src="/__mockup/images/nodaq-dark-glass-abstract.png" 
        alt=""
        style={{
          position: "absolute",
          top: "5%",
          right: "-10%",
          width: 800,
          opacity: 0.6,
          y: y1,
          filter: "blur(4px) drop-shadow(0 0 40px rgba(138,43,226,0.2))",
          zIndex: 0,
          pointerEvents: "none"
        }}
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 0.6, scale: 1 }}
        transition={{ duration: 1.5, ease: "easeOut" }}
      />

      <div style={{ maxWidth: 1400, margin: "0 auto", position: "relative", zIndex: 10 }}>
        {/* ── Nav ── */}
        <nav
          className="glass-nav"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 60px",
            position: "sticky",
            top: 0,
            zIndex: 50,
          }}
        >
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div
              style={{
                width: 44,
                height: 44,
                background: "rgba(255,255,255,0.05)",
                border: `1px solid rgba(255,255,255,0.1)`,
                borderRadius: 12,
                display: "grid",
                placeItems: "center",
                boxShadow: "0 0 20px rgba(0, 240, 255, 0.15)"
              }}
            >
              <Hexagon size={22} color={NEON_CYAN} strokeWidth={2} />
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span
                className="dark-glass-heading"
                style={{ fontWeight: 700, fontSize: 24, lineHeight: 1, letterSpacing: "-0.02em" }}
              >
                Nodaq
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.2em",
                  marginTop: 4,
                  color: NEON_PURPLE
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
            <Pill>Connexion</Pill>
            <Pill primary>
              Essai Gratuit <ArrowRight size={16} strokeWidth={2.5} />
            </Pill>
          </div>
        </nav>

        {/* ── Hero ── */}
        <div
          style={{
            padding: "100px 60px 120px",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 80,
            alignItems: "center",
          }}
        >
          {/* Left */}
          <div>
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, type: "spring", stiffness: 100 }}
            >
              <Badge icon={Sparkles}>L'outil premium des maîtres d'œuvre</Badge>
            </motion.div>

            <motion.h1
              className="dark-glass-heading"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: 0.1,
                duration: 0.6,
                type: "spring",
                damping: 20,
              }}
              style={{
                fontSize: 64,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: "-0.03em",
                margin: "32px 0 32px",
              }}
            >
              L'artisanat <br />
              <span style={{ color: TEXT_MUTED }}>exige de la</span>
              <br />
              <span className="neon-text">
                précision absolue.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.8 }}
              style={{
                fontSize: 18,
                fontWeight: 400,
                lineHeight: 1.6,
                color: TEXT_MUTED,
                maxWidth: 500,
                margin: "0 0 48px",
              }}
            >
              Chantiers, devis, facturation et trésorerie réunis dans un espace
              clair et élégant. Vous bâtissez, nous organisons l'avenir.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              style={{ display: "flex", gap: 20, marginBottom: 72 }}
            >
              <Pill primary>
                Ouvrir mon espace <ArrowRight size={18} strokeWidth={2.5} />
              </Pill>
              <Pill>Découvrir</Pill>
            </motion.div>

            {/* Stats */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 20,
              }}
            >
              <Stat value="4.8K" label="Artisans connectés" delay={0.5} />
              <Stat value="98M€" label="Volume géré" delay={0.6} />
              <Stat value="ZERO" label="Papier utilisé" delay={0.7} />
            </div>
          </div>

          {/* Right — card grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 24,
            }}
          >
            {/* CA card */}
            <Card
              delay={0.2}
              style={{ gridColumn: "span 2" }}
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
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      color: TEXT_MUTED,
                      marginBottom: 8,
                      letterSpacing: "0.05em",
                      textTransform: "uppercase",
                    }}
                  >
                    CA — Nov 2026
                  </div>
                  <div
                    className="dark-glass-heading"
                    style={{
                      fontSize: 48,
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
                    gap: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    background: "rgba(0,240,255,0.1)",
                    color: NEON_CYAN,
                    border: `1px solid rgba(0,240,255,0.2)`,
                    borderRadius: 999,
                    padding: "6px 14px",
                  }}
                >
                  <TrendingUp size={16} strokeWidth={2.5} /> +12,4%
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
                  borderBottom: `1px solid rgba(255,255,255,0.05)`
                }}
              >
                <div
                  className="dark-glass-heading"
                  style={{ fontSize: 22, fontWeight: 700 }}
                >
                  Chantiers en cours
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#FFF",
                    background: "rgba(255,255,255,0.05)",
                    border: `1px solid rgba(255,255,255,0.1)`,
                    borderRadius: 999,
                    padding: "6px 14px",
                  }}
                >
                  <PulseDot color={NEON_CYAN} /> 3 ACTIFS
                </div>
              </div>
              {AFFAIRES.map((a, i) => (
                <PipelineRow key={i} {...a} delay={i * 0.1} />
              ))}
            </Card>

            {/* Trésorerie card */}
            <Card delay={0.4} style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.02), rgba(138,43,226,0.05))" }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  background: "rgba(138,43,226,0.1)",
                  border: `1px solid rgba(138,43,226,0.2)`,
                  borderRadius: 12,
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 20,
                }}
              >
                <ShieldCheck size={24} color={NEON_PURPLE} />
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: TEXT_MUTED,
                  marginBottom: 4,
                }}
              >
                Trésorerie
              </div>
              <div
                className="dark-glass-heading"
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                }}
              >
                12 450 €
              </div>
            </Card>

            {/* Factures card */}
            <Card delay={0.5}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  background: "rgba(0,240,255,0.1)",
                  border: `1px solid rgba(0,240,255,0.2)`,
                  borderRadius: 12,
                  display: "grid",
                  placeItems: "center",
                  marginBottom: 20,
                }}
              >
                <FileText size={24} color={NEON_CYAN} />
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: TEXT_MUTED,
                  marginBottom: 4,
                }}
              >
                Factures
              </div>
              <div
                className="dark-glass-heading"
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8
                }}
              >
                7 <span style={{ fontSize: 16, color: TEXT_MUTED, fontWeight: 500 }}>ÉMISES</span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  marginTop: 12,
                  color: NEON_PINK,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6
                }}
              >
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: NEON_PINK }} /> 
                2 EN ATTENTE
              </div>
            </Card>
          </div>
        </div>

        {/* ── Feature strip ── */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="glass-panel"
          style={{
            margin: "0 60px 100px",
            padding: "32px 48px",
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 24,
            background: "linear-gradient(90deg, rgba(255,255,255,0.01), rgba(255,255,255,0.03))"
          }}
        >
          {[
            { icon: CalendarDays, label: "Planning intelligent", color: NEON_CYAN },
            { icon: FileText, label: "Devis & Factures", color: "#FFF" },
            { icon: Activity, label: "Rentabilité temps réel", color: NEON_PURPLE },
            { icon: ShieldCheck, label: "Synchro Bancaire", color: NEON_PINK },
          ].map(({ icon: Icon, label, color }) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: 15,
                fontWeight: 500,
                color: "#FFF",
              }}
            >
              <div style={{ 
                background: "rgba(255,255,255,0.05)", 
                padding: 10, 
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.1)"
              }}>
                <Icon size={20} color={color} />
              </div>
              {label}
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
