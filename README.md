# Site Elegance Cars

Site statique : HTML, CSS et JavaScript, sans installation ni compilation.

- `index.html` : la page d'accueil
- `reels.html` : la page des reels Instagram
- `cars.json` : le stock de voitures (mis à jour automatiquement depuis Moteur.ma)
- `assets/` : logo ; `assets/cars/` : photos des voitures (nommées par numéro d'annonce Moteur.ma)
- `scripts/sync-moteur.mjs` : le programme qui lit la vitrine Moteur.ma
- `.github/workflows/sync-moteur.yml` : lance ce programme toutes les 3 heures sur GitHub

## Synchronisation avec Moteur.ma
Toutes les 3 heures, GitHub lit la vitrine Moteur.ma d'Elegance Cars :
- une nouvelle annonce est ajoutée au site, avec sa photo ;
- une annonce retirée de Moteur.ma (voiture vendue) disparaît du site.
Netlify republie le site automatiquement après chaque mise à jour.
Pour lancer une mise à jour tout de suite : GitHub > onglet Actions > « Synchroniser le stock Moteur.ma » > Run workflow.
Pour corriger le nom d'une voiture, modifiez son « model » dans `cars.json` : la correction est conservée.

## Voir le site en local (VS Code)
Installez l'extension « Live Server », puis clic droit sur `index.html` > « Open with Live Server ».
(Le stock se charge depuis `cars.json`, il faut donc passer par Live Server plutôt que d'ouvrir le fichier directement.)

## Lancer la synchronisation sur votre PC
Avec Node.js installé : `node scripts/sync-moteur.mjs`
