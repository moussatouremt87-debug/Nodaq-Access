#!/bin/bash
# Build Vercel de la landing : copie les pages puis rapatrie les binaires.
# Les captures viennent du dépôt (source de vérité) ; la vidéo d'ambiance et
# son poster viennent du stockage Higgsfield où le montage a été produit —
# s'ils deviennent indisponibles, la page reste fonctionnelle (garde-fous
# côté client), seul l'arrière-plan animé disparaît.
set -e
mkdir -p public

# Chaque fichier : copie locale si présente (déploiement depuis le dépôt),
# sinon téléchargement depuis le dépôt (déploiement « mince » sans git lié).
# LANDING_REF permet de viser une branche ; défaut : main.
RAW="https://raw.githubusercontent.com/moussatouremt87-debug/Nodaq-Access/${LANDING_REF:-main}/marketing/landing"
for f in index.html mentions-legales.html confidentialite.html cgv.html robots.txt sitemap.xml \
         cockpit-annote.png devis-dicte.png marge-mission.png echeancier.png; do
  cp "$f" "public/$f" 2>/dev/null || curl -sfS -o "public/$f" "$RAW/$f"
done

HF="https://d2ol7oe51mr4n9.cloudfront.net/user_31RbU03qVIrIECkS5jmxO68g2HF"
curl -sfS -o public/bg-quotidien.mp4 "$HF/b2b42a8b-1cbe-4d60-a9e1-306efa07c2e5.mp4" \
  || echo "AVERTISSEMENT : vidéo d'ambiance indisponible — la page reste fonctionnelle sans elle."
curl -sfS -o public/bg-quotidien.webm "$HF/89e5e377-c2eb-43b5-94ef-3fe9ad835e2e.mp4" \
  || echo "AVERTISSEMENT : variante WebM indisponible."
curl -sfS -o public/bg-poster.jpg "$HF/2c8b0987-213d-4e3d-aa09-bd46a724e72a.jpg" \
  || echo "AVERTISSEMENT : poster indisponible."

ls -l public/
