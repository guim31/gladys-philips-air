# Philips Air

Pilotez vos **purificateurs et humidificateurs d'air Philips** connectés depuis Gladys, sur votre réseau
local, sans le cloud Philips : qualité de l'air (PM2.5, indice d'allergènes, humidité), modes et vitesse du
ventilateur, humidité cible, sécurité enfant, éclairage de l'écran, et heures restantes de chaque filtre. Les
changements faits sur le purificateur ou dans l'application Philips arrivent dans Gladys en quelques secondes.

> **Développée sans le matériel : vos retours sont les bienvenus** (« Developed without the hardware: feedback
> welcome »). Cette intégration a été écrite d'après le protocole documenté par la communauté open source, et
> testée contre un purificateur simulé. Si votre modèle se comporte autrement, ouvrez une issue sur
> https://github.com/guim31/gladys-philips-air/issues avec la sortie du script de sonde (voir Dépannage).
>
> Sans lien avec Philips ni Versuni. Philips est une marque de Koninklijke Philips N.V.

## Prérequis

- Gladys Assistant 5.1 ou plus récent.
- Un purificateur ou humidificateur Philips Wi-Fi qui parle le protocole local **CoAP** (port UDP 5683) : la
  série AC (AC2889, AC2729, AC3829, AC3858, AC4236, Series 2000i et 3000i…), les récents AC0850, AC0950,
  AC2220, AC3220, AC3420, AC4220, et les humidificateurs HU (HU1509, HU4209, HU5710…). La liste complète est
  dans « Modèles pris en charge ».
- Le purificateur installé une fois dans l'application **Philips Air+** (c'est là qu'il rejoint votre Wi-Fi),
  sur le même réseau local que Gladys.
- Son **adresse IP**. Votre box l'affiche (l'appareil apparaît souvent sous le nom `MXCHIP…`). Donnez-lui une
  adresse fixe (bail DHCP réservé) dans votre box : l'intégration cherche le purificateur à l'adresse saisie.

## Configuration

Dans Gladys, ouvrez **Intégrations → Philips Air → Configuration** :

| Champ                              | Rôle                                                                                                                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adresses IP des purificateurs      | Une ou plusieurs adresses IPv4, séparées par des virgules.                                                                                                                                                                  |
| Intervalle de rafraîchissement     | Fréquence de lecture de chaque purificateur (10 s à 2 min, 30 s par défaut). Les changements sont en général envoyés tout de suite par le purificateur ; cette lecture est le filet de sécurité.                            |
| Alerte de remplacement des filtres | Quand le déclencheur d'entretien part pour un filtre à remplacer : quand le purificateur le demande (par défaut), ou 1 jour, 3 jours, 1 semaine avant. Le pré-filtre est toujours signalé quand le purificateur le demande. |
| Langue des noms des appareils      | Langue des noms donnés aux nouveaux appareils, à leurs fonctionnalités, à la liste des modes et aux messages du déclencheur. Français par défaut.                                                                           |

Enregistrez, puis ouvrez l'onglet **Découverte** : un appareil par purificateur, nommé d'après son nom dans
l'application Philips et son modèle, par exemple `Chambre (AC2729/10)`. Ajoutez-le à Gladys.

Le bouton **Vérifier les purificateurs** (écran de configuration) lit toutes les adresses d'un coup et indique
quels purificateurs répondent, et quel modèle n'est pas dans la liste de l'intégration.

## L'appareil

Chaque purificateur ne reçoit que les fonctionnalités de son modèle :

| Fonctionnalité                      | Dans Gladys                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| Marche / arrêt                      | Interrupteur.                                                                         |
| Mode                                | Liste des modes du modèle (voir plus bas).                                            |
| Vitesse du ventilateur              | Vitesse manuelle, de 1 à 2, 3 ou 5 selon le modèle. La régler sélectionne « Manuel ». |
| PM2.5                               | Particules fines, en µg/m³.                                                           |
| Indice d'allergènes                 | Indice d'allergènes intérieurs de Philips, de 1 (bon) à 12 (très mauvais).            |
| Humidité                            | Humidité relative, en % (modèles avec capteur d'humidité).                            |
| Température                         | En °C (modèles avec capteur de température).                                          |
| Humidité cible                      | Liste des consignes acceptées par l'humidificateur (40 à 70 %, ou 30 à 70 %).         |
| Humidification                      | Allume ou éteint la partie humidificateur d'un purificateur 2-en-1.                   |
| Réservoir d'eau                     | « Bas » quand le réservoir est vide ou retiré, « Normal » sinon.                      |
| Sécurité enfant                     | Verrouille les boutons du purificateur.                                               |
| Éclairage de l'écran                | Luminosité de l'écran et de l'anneau de qualité de l'air.                             |
| Pré-filtre (heures restantes)       | Heures avant le prochain nettoyage du pré-filtre.                                     |
| Filtre HEPA (heures restantes)      | Heures avant le remplacement du filtre HEPA (ou NanoProtect).                         |
| Filtre à charbon (heures restantes) | Heures avant le remplacement du filtre à charbon actif.                               |
| Mèche (heures restantes)            | Heures avant le remplacement de la mèche de l'humidificateur.                         |

### Modes

Selon le modèle : **Auto**, **Allergènes**, **Bactéries et virus**, **Pollution**, **Doux**, **Moyen**,
**Fort**, **Sommeil**, **Sommeil allergies**, **Turbo**, et **Manuel** (une vitesse fixe). Choisir un mode
allume aussi le purificateur. Un modèle absent de la liste de l'intégration garde ses capteurs, son
interrupteur et ses filtres, mais pas de liste de modes.

## Widget du tableau de bord

Le widget **Purificateur Philips** affiche, pour le purificateur choisi dans ses réglages :

- la PM2.5 et l'humidité, en direct ;
- le mode, l'indice d'allergènes sur l'échelle Philips (Bon, Moyen, Mauvais, Très mauvais), le boost en
  cours et son heure de fin, et ce que le purificateur demande (ou le filtre le plus proche de sa fin) ;
- des boutons : deux modes courants (Auto ou Pollution, Sommeil), **Boost** de 15, 30 ou 60 minutes (réglage
  du widget), et marche/arrêt.

## Déclencheur de scène

**Entretien du purificateur nécessaire** part une fois quand un purificateur commence à demander un entretien,
et de nouveau seulement après qu'il a été fait (filtre changé, réservoir rempli) :

- Pré-filtre à nettoyer (quand le purificateur le demande) ;
- Filtre HEPA à remplacer, Filtre à charbon à remplacer, Mèche à remplacer (quand le purificateur le demande,
  ou plus tôt : voir le réglage « Alerte de remplacement des filtres ») ;
- Réservoir d'eau vide (pendant l'humidification).

Filtres : le purificateur, et les éléments qui vous intéressent. Variables : `item`, `hours_left`, et
`message`, un texte prêt à envoyer comme « Chambre (AC2729/10): Filtre HEPA à remplacer (encore 70 h) », dans
la langue de la configuration.

## Action de scène

**Booster le purificateur** passe le purificateur en Turbo (ou à sa vitesse la plus haute) pendant 5 à 240
minutes, puis le remet dans son mode d'avant, ou l'éteint s'il était éteint. Si quelqu'un change le
purificateur pendant le boost, le boost se termine sans y toucher. L'action renvoie `until`, la fin du boost.

## Exemples de scènes

- **Après la cuisine** : quand la PM2.5 de la cuisine dépasse 35 µg/m³, **Booster le purificateur** 20
  minutes.
- **Rappel des filtres** : sur **Entretien du purificateur nécessaire**, envoyer
  `{{triggerEvent.data.message}}` sur votre téléphone.
- **Nuit** : à 22 h 30, mode **Sommeil** et éclairage de l'écran éteint pour le purificateur de la chambre ; à
  7 h, retour en **Auto**.
- **Absence** : quand la maison est vide, purificateurs en **Auto** ; au retour de la première personne,
  **Booster le purificateur** 15 minutes.

## Dépannage

- **« Aucun purificateur Philips ne répond »** : vérifiez l'adresse IP (elle a pu changer : fixez-la), que le
  purificateur est branché et connecté au Wi-Fi, et qu'il répond dans l'application Philips. Un pare-feu strict
  sur la machine de Gladys (ufw…) peut bloquer l'UDP entre le conteneur de l'intégration et votre réseau.
- **Ça marchait, puis plus de réponse** : le firmware de ces purificateurs est connu pour cesser de répondre
  en local au bout d'un moment (constaté aussi avec Home Assistant). Débranchez le purificateur 10 secondes ;
  l'intégration se reconnecte seule.
- **Un modèle sans liste de modes** : votre modèle n'est pas encore dans la liste. Lancez le script de sonde
  depuis un ordinateur du même réseau, `node scripts/probe.mjs <adresse IP>` (dans un clone du dépôt,
  Node.js 22+) : il ne fait que lire et masque les identifiants. Collez sa sortie dans une issue.
- **Plus de détails** : les journaux de l'intégration (Gladys → Intégrations → Philips Air → Journaux) ne
  montrent que la vie des purificateurs au niveau normal ; `LOG_LEVEL=debug` sur le conteneur montre chaque
  lecture.

## Limites

- Commande locale uniquement (CoAP sur UDP 5683). Les anciens modèles qui ne parlent que HTTP, et les
  firmwares récents qui ont fermé l'accès local, ne sont pas pris en charge.
- Pas de découverte automatique : les purificateurs ne s'annoncent pas d'une façon que le conteneur de Gladys
  peut voir. Saisissez leur adresse IP.
- Les listes de modes viennent de ce que la communauté open source a observé : un modèle peut accepter un mode
  absent de sa liste, ou l'inverse. Minuterie, bip, lumière d'ambiance et « indice préféré » de certains
  modèles ne sont pas exposés.
- Les changements poussés traversent le réseau Docker de Gladys ; s'ils ne passent pas, la lecture suivante
  (30 s par défaut) les apporte.
- Un boost en cours survit à un redémarrage de l'intégration, mais se termine à la réponse suivante si le
  purificateur était absent à l'heure prévue.

## Modèles pris en charge

- Série AC, firmware classique : AC2729, AC2889, AC2936, AC2939, AC2958, AC2959, AC3021, AC3033, AC3036,
  AC3039, AC3055, AC3059, AC3259, AC3829, AC3854/50, AC3854/51, AC3858/50, AC3858/51, AC3858/83, AC3858/86,
  AC4231, AC4236, AC5659, AC5660.
- AC1715 et AC0850 (firmware « AWS_Philips_AIR »).
- Nouvelle génération : AC0850 (firmware « AWS_Philips_AIR_Combo »), AC0950, AC0951, AC2210, AC2220, AC2221,
  AC3210, AC3220, AC3221, AC3420, AC3421, AC4220, AC4221.
- Humidificateurs : HU1509, HU1510, HU4209, HU4210, HU5710.

Les autres modèles de ces générations reçoivent leurs capteurs, leur interrupteur et leurs filtres.

## Support et remerciements

Issues et retours : https://github.com/guim31/gladys-philips-air/issues

Le protocole a été rétro-conçu par Radoslav Gerganov (py-air-control) et implémenté par betaboon et kongo09
(aioairctrl, philips-airpurifier-coap pour Home Assistant) ; cette intégration leur doit tout. Sans lien avec
Philips ni Versuni.
