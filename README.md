# Meloa

Meloa est un petit studio musical dans le navigateur. Compose une boucle de quatre mesures au piano ou à la batterie, joue une idée au clavier ou au micro, puis exporte le résultat en WAV.

**[Ouvrir Meloa](https://samy-asl.github.io/Meloa/)**

## Prise en main

- **Séquenceur** — Ajoute, déplace, redimensionne ou duplique des notes sur la grille. Ajuste le tempo et écoute ta boucle.
- **Clavier** — Joue avec les touches indiquées à l’écran. Utilise **W** et **X** pour changer d’octave. Enregistre ta prise, réécoute-la, puis ajoute-la à la grille.
- **Micro** — Fredonne une mélodie à une note à la fois ou tape un rythme. Choisis **Rythme**, **Mélodie** ou **Les deux**, puis compare l’audio original au résultat avant de l’ajouter à la grille. Autorise l’accès au microphone pour enregistrer.

Meloa sauvegarde la boucle dans ton navigateur. Le menu **Projet** permet de télécharger et de rouvrir un fichier JSON pour reprendre le travail. **Exporter en WAV** produit un fichier audio stéréo.

## Lancer en local

Meloa utilise HTML, CSS et JavaScript, avec Web Audio pour la lecture et l’enregistrement. Le site tourne sans installation de dépendances ni compilation.

```bash
git clone https://github.com/Samy-Asl/Meloa.git
cd Meloa
python3 -m http.server 8000
```

Ouvre [http://localhost:8000](http://localhost:8000). Pour lancer les tests, exécute `node --test tests/*.mjs` avec Node.js 24.

## Crédits audio

Le piano est tiré de *Salamander Grand Piano V3* et la batterie de *Virtuosity Drums*. Les sources, les adaptations et les licences des échantillons figurent dans les [crédits audio](assets/credits.txt).
