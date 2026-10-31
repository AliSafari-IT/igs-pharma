// All page text, per language. Dutch (nl-BE) is the main language; French, German and English mirror it.
// The audience is the general public in Belgium: formal address (u, vous, Sie), short literal sentences.
// Medicine rules: nothing here promotes a product, a price or a discount. The page describes a service
// that is not open yet, and says so. Keep it that way (KB 7 april 1995, medicine advertising).

export const CONTACT_EMAIL = "privacy@igs-pharma.be";
export const POLICY_UPDATED = "2026-10-25";
/** The order the language switch lists them in. */
export const LANGS = ["nl", "fr", "de", "en"];

const nl = {
  lang: "nl-BE",
  code: "NL",
  langName: "Nederlands",
  skip: "Naar de inhoud",
  themeLabel: "Donker thema",
  langLabel: "Taal",
  nav: {
    what: "Wat komt er",
    site: "De website",
    app: "De app",
    care: "Zorgvuldig",
    plan: "Planning",
    faq: "Vragen",
  },
  playSoon: "Binnenkort op Google Play",
  shopSoon: "Webshop: binnenkort",
  meta: {
    title: "IGS-Pharma: uw apotheek, ook online",
    description:
      "IGS-Pharma bouwt een online apotheek voor België: een webshop voor producten zonder voorschrift, nagekeken door een apotheker, en een gratis Android-app. Nog niet open.",
  },
  hero: {
    kicker: "Online apotheek voor België · in opbouw",
    title: "Uw apotheek, ook online.",
    lead: "IGS-Pharma brengt een Belgische apotheek online. Een webshop voor producten zonder voorschrift, waar een apotheker meekijkt. En een gratis Android-app om producten op te zoeken en uw apotheek te bereiken.",
    note: "We zijn nog niet open. U kan nog niets bestellen.",
    cta: "Bekijk de app",
    ctaSite: "Bekijk de website",
    chips: [
      "NL · FR · DE · EN",
      "Prijs incl. btw",
      "Op voorraad",
      "Vraag het uw apotheker",
      "Gratis app",
    ],
  },
  what: {
    title: "Wat er komt",
    lead: "Eén apotheek, twee manieren om ze te bereiken. De apotheek blijft altijd de verkoper en uw zorgverlener.",
    items: [
      {
        icon: "cart",
        tag: "Fase 1",
        title: "De webshop",
        text: "Producten zonder voorschrift: verzorging, baby, vitaminen, EHBO en geneesmiddelen zonder voorschrift. Met de bijsluiter erbij. Bestellingen met geneesmiddelen kijkt een apotheker eerst na.",
      },
      {
        icon: "phone",
        tag: "Fase 1",
        title: "De Android-app",
        text: "Zoek een product, zie prijs en beschikbaarheid, zet het op uw lijstje en bel of vind uw apotheek. Bestellen gaat via de webshop. Geen account nodig.",
      },
      {
        icon: "rx",
        tag: "Later",
        title: "Voorschriften en zorg",
        text: "Een elektronisch voorschrift online reserveren, en het ophalen en betalen in de apotheek. Met herinneringen en afspraken. Pas als de wet en de apotheek er klaar voor zijn.",
      },
    ],
  },
  app: {
    title: "De app, stap voor stap",
    lead: "Een zakversie van de apotheek. Rustig en duidelijk, in uw taal. Zo werkt het.",
    play: "Afspelen",
    pause: "Pauzeren",
    caption: "Illustratie met voorbeeldproducten.",
    steps: [
      {
        title: "Zoeken",
        text: "Typ een naam, een merk of de CNK-code van de verpakking. Of kies een categorie.",
      },
      {
        title: "Resultaten",
        text: "U ziet meteen de prijs met btw en of het op voorraad is. In woorden, niet alleen met een kleur.",
      },
      {
        title: "Het product",
        text: "Beschrijving, gebruik en waarschuwingen. Bij geneesmiddelen: lees de bijsluiter en vraag raad aan uw apotheker.",
      },
      {
        title: "Mijn lijstje",
        text: "Zet producten op uw lijstje. Het blijft op uw telefoon. Toon het aan de toonbank.",
      },
      {
        title: "Uw apotheek",
        text: "Bellen, de route, de openingsuren. En de apotheek van wacht en de noodnummers.",
      },
      {
        title: "Bestellen op de website",
        text: "Bestellen en betalen gebeurt in de webshop. Daar kijkt een apotheker uw bestelling na.",
      },
    ],
    screen: {
      app: "IGS-Pharma",
      search: "Zoek een product of CNK",
      categories: ["Gezondheid", "Huid", "Baby", "Vitaminen"],
      pharmacy: "Uw apotheek",
      open: "Open · bel of plan uw route",
      query: "zonnecrème",
      results: [
        ["Zonnecrème SPF 50", "€ 14,95", "Op voorraad"],
        ["Zonnemelk kind SPF 50+", "€ 16,50", "Nog enkele"],
        ["After-sun gel", "€ 8,95", "Op voorraad"],
      ],
      productName: ["Zonnecrème SPF 50", "200 ml"],
      cnk: "CNK 1234-567 · voorbeeld",
      price: "€ 14,95",
      vat: "incl. btw",
      stock: "Op voorraad",
      productText: ["Elke 2 uur opnieuw", "aanbrengen. Niet in de", "volle zon tussen 12 en 16 u."],
      add: "Op mijn lijstje",
      order: "Bestellen op de website",
      listTitle: "Mijn lijstje",
      listItems: [
        ["Zonnecrème SPF 50", "€ 14,95"],
        ["After-sun gel", "€ 8,95"],
      ],
      listNote: "Staat alleen op uw telefoon.",
      counter: "Toon aan de toonbank",
      call: "Bellen",
      route: "Route",
      hours: "Openingsuren",
      duty: "Apotheek van wacht",
      emergency: ["Noodgeval: 112", "Antigifcentrum:", "070 245 245"],
      site: "igs-pharma.be",
      checkout: "Afrekenen",
      checked: ["Een apotheker kijkt", "uw bestelling na."],
      back: "Terug naar de app",
    },
  },
  care: {
    title: "Zorgvuldig, vanaf de eerste dag",
    lead: "Ook zonder voorschrift kan een aankoop iets zeggen over uw gezondheid. Daarom bouwen we IGS-Pharma zoals een zorgsysteem.",
    items: [
      {
        icon: "pharmacist",
        title: "Een apotheker kijkt mee",
        text: "Bestellingen met geneesmiddelen worden nagekeken voor ze vertrekken. Met vragen kan u altijd bij de apotheek terecht.",
      },
      {
        icon: "leaflet",
        title: "Informatie, geen reclame",
        text: "Neutrale productinformatie en de bijsluiter. Geen acties of pushberichten voor geneesmiddelen.",
      },
      {
        icon: "lock",
        title: "Uw gegevens zijn gevoelig",
        text: "We behandelen ze als gezondheidsgegevens: zo weinig mogelijk, goed beveiligd, met een spoor van wie wat deed.",
      },
      {
        icon: "eu",
        title: "In Europa",
        text: "De gegevens van de webshop worden in de Europese Unie verwerkt.",
      },
      {
        icon: "eye",
        title: "Geen tracking",
        text: "Geen advertenties, geen analytics, geen trackers van andere bedrijven. Op deze site niet, in de app niet.",
      },
      {
        icon: "speak",
        title: "In uw taal",
        text: "Nederlands, Frans, Duits en Engels. Licht of donker thema, en grotere tekst in de app.",
      },
    ],
  },
  plan: {
    title: "Waar we nu staan",
    lead: "We geven nog geen datum. We openen pas als alles klopt, ook juridisch.",
    steps: [
      {
        status: "Nu",
        title: "We bouwen en testen",
        text: "De webshop en het beheer voor de apotheek bestaan al. We testen ze met verzonnen producten.",
      },
      {
        status: "Daarna",
        title: "De webshop opent",
        text: "Na de juridische controle en de melding bij het FAGG, de overheid die online apotheken registreert.",
      },
      {
        status: "Daarna",
        title: "De app op Google Play",
        text: "Eerst een test met een kleine groep, dan voor iedereen. De app toont de producten van de webshop.",
      },
      {
        status: "Later",
        title: "Voorschriften en zorg",
        text: "Reserveren met een elektronisch voorschrift, herinneringen en afspraken in de apotheek.",
      },
    ],
  },
  privacyCard: {
    title: "Privacy in het kort",
    text: "Deze website en de app volgen u niet. De app heeft geen account. Uw lijstje en instellingen blijven op uw telefoon.",
    privacy: "Privacybeleid",
    delete: "Uw gegevens verwijderen",
  },
  site: {
    title: "De website",
    lead: "De webshop is een echte, werkende website. We testen hem met verzonnen producten en hij opent als de apotheek er klaar voor is.",
    items: [
      {
        icon: "speak",
        title: "In uw taal",
        text: "Nederlands, Frans, Duits en Engels, een licht en een donker thema, en gemaakt om met toetsenbord en schermlezer te gebruiken.",
      },
      {
        icon: "leaflet",
        title: "Duidelijke prijs en voorraad",
        text: "De prijs is inclusief btw en de voorraad staat in woorden. Elk product heeft zijn bijsluiter.",
      },
      {
        icon: "cart",
        title: "Afhalen nu, levering straks",
        text: "Haal uw bestelling gratis op in de apotheek. Levering aan huis met Sendcloud komt eraan, met de kost vóór u betaalt.",
      },
      {
        icon: "pharmacist",
        title: "Een apotheker kijkt mee",
        text: "Een bestelling met een geneesmiddel wordt door een apotheker nagekeken voor ze klaargemaakt wordt.",
      },
      {
        icon: "lock",
        title: "Een beheer voor de apotheek",
        text: "Voorraad met vervaldata, terugroepacties, prijzen, bestellingen en nazicht, voor medewerkers die met een passkey inloggen.",
      },
      {
        icon: "eu",
        title: "Zorgvuldig met uw gegevens",
        text: "Gehost in de Europese Unie, geen tracking, en tijdens de test alleen vroege toegang op uitnodiging.",
      },
    ],
  },
  maker: {
    kicker: "Achter IGS-Pharma",
    title: "Gebouwd door Ali Safari",
    lead: "Ali (ASafariM) is een full-stack, AI-gedreven app-ontwikkelaar. IGS-Pharma toont hoe dat in de praktijk werkt: een webshop, een beheer voor de apotheek en een Android-app, van het eerste idee tot een zorgvuldig, getest product.",
    items: [
      {
        icon: "code",
        tag: "Full stack",
        title: "Van scherm tot database",
        text: "Een winkel in vier talen, een beheer, achtergrondtaken, een database met auditspoor en een Android-app, gemaakt om samen te werken.",
      },
      {
        icon: "spark",
        tag: "AI-gedreven",
        title: "Snel, en nagekeken",
        text: "AI-assistenten helpen de code schrijven en testen. Bij elke wijziging draaien automatische tests en een mens kijkt na en voegt ze samen.",
      },
      {
        icon: "lock",
        tag: "Zorgvuldig",
        title: "Zorgvuldig door ontwerp",
        text: "Inloggen met passkey voor medewerkers, rollen en rechten, een auditspoor en privacy als standaard.",
      },
    ],
    stackLabel: "Gebruikte tools",
    stack: [
      "Next.js",
      "React",
      "TypeScript",
      "Node.js",
      "PostgreSQL",
      "Expo en Android",
      "Docker",
      "CI/CD",
      "AI-ondersteunde ontwikkeling",
    ],
    cta: "Meer werk op asafarim.com",
  },
  faq: {
    title: "Vragen",
    items: [
      {
        q: "Kan ik al bestellen?",
        a: "Nee. De webshop is nog niet open. Hij komt op igs-pharma.be. Tot dan kan u gewoon bij uw apotheek terecht.",
      },
      {
        q: "Is er een website?",
        a: "Ja. De webshop van IGS-Pharma werkt al en wordt getest met verzonnen producten. Hij is nog niet open. Hij komt op igs-pharma.be. Tot dan tonen deze pagina en de app wat er komt.",
      },
      {
        q: "Kan ik geneesmiddelen op voorschrift bestellen?",
        a: "Nee. In België mogen geneesmiddelen op voorschrift niet online verkocht en opgestuurd worden. Later kan u ze met een elektronisch voorschrift reserveren, en dan haalt en betaalt u ze in de apotheek.",
      },
      {
        q: "Wat kan de app?",
        a: "Producten zoeken, prijs en beschikbaarheid zien, de productinformatie lezen, een lijstje maken en uw apotheek bereiken. Bestellen gaat via de webshop. De app is gratis.",
      },
      {
        q: "Heb ik een account nodig?",
        a: "Niet voor de app. Uw lijstje, taal en thema blijven op uw telefoon. Voor de webshop kan u later bestellen als gast of met een account.",
      },
      {
        q: "Ik heb een medische vraag.",
        a: "Vraag het uw apotheker of uw arts. In een noodgeval: bel 112. Bij een vergiftiging: Antigifcentrum 070 245 245. De apotheek van wacht vindt u op apotheek.be of via 0903 99 000.",
      },
      {
        q: "Wie zit erachter?",
        a: "IGS-Pharma wordt gebouwd door Ali Safari (ASafariM), een full-stack, AI-gedreven app-ontwikkelaar, voor en met een Belgische apotheek. De apotheek is de verkoper en uw zorgverlener. Haar gegevens (adres, titularis-apotheker, erkenningsnummer) komen op de webshop als die opent.",
      },
    ],
  },
  footer: {
    tagline: "Online apotheek voor België, in opbouw.",
    privacy: "Privacy",
    cookies: "Cookies",
    delete: "Gegevens verwijderen",
    os: "ASafariM OS",
    maker: "Gebouwd door ASafariM",
    rights: "ASafariM. IGS-Pharma is nog niet open; deze site verkoopt niets.",
    emergency: "Noodgeval: 112 · Antigifcentrum: 070 245 245",
  },
  back: "Terug naar IGS-Pharma",
  notFound: {
    title: "Deze pagina bestaat niet",
    text: "Misschien is de link oud of fout getypt.",
    home: "Naar de startpagina",
  },
};

const fr = {
  lang: "fr-BE",
  code: "FR",
  langName: "Français",
  skip: "Aller au contenu",
  themeLabel: "Thème sombre",
  langLabel: "Langue",
  nav: {
    what: "Ce qui arrive",
    site: "Le site",
    app: "L'app",
    care: "Avec soin",
    plan: "Calendrier",
    faq: "Questions",
  },
  playSoon: "Bientôt sur Google Play",
  shopSoon: "Boutique : bientôt",
  meta: {
    title: "IGS-Pharma : votre pharmacie, aussi en ligne",
    description:
      "IGS-Pharma construit une pharmacie en ligne pour la Belgique : une boutique pour les produits sans ordonnance, vérifiée par un pharmacien, et une app Android gratuite. Pas encore ouverte.",
  },
  hero: {
    kicker: "Pharmacie en ligne pour la Belgique · en construction",
    title: "Votre pharmacie, aussi en ligne.",
    lead: "IGS-Pharma met une pharmacie belge en ligne. Une boutique pour les produits sans ordonnance, avec un pharmacien qui veille. Et une app Android gratuite pour chercher un produit et joindre votre pharmacie.",
    note: "Nous ne sommes pas encore ouverts. Vous ne pouvez encore rien commander.",
    cta: "Découvrir l'app",
    ctaSite: "Voir le site",
    chips: [
      "NL · FR · DE · EN",
      "Prix TVAC",
      "En stock",
      "Demandez à votre pharmacien",
      "App gratuite",
    ],
  },
  what: {
    title: "Ce qui arrive",
    lead: "Une pharmacie, deux façons de la joindre. La pharmacie reste toujours le vendeur et votre prestataire de soins.",
    items: [
      {
        icon: "cart",
        tag: "Phase 1",
        title: "La boutique en ligne",
        text: "Les produits sans ordonnance : soins, bébé, vitamines, premiers secours et médicaments sans ordonnance. Avec la notice. Un pharmacien vérifie d'abord les commandes qui contiennent des médicaments.",
      },
      {
        icon: "phone",
        tag: "Phase 1",
        title: "L'app Android",
        text: "Cherchez un produit, voyez le prix et la disponibilité, ajoutez-le à votre liste, et appelez ou trouvez votre pharmacie. La commande se fait sur la boutique. Sans compte.",
      },
      {
        icon: "rx",
        tag: "Plus tard",
        title: "Ordonnances et soins",
        text: "Réserver en ligne avec une prescription électronique, puis retirer et payer à la pharmacie. Avec des rappels et des rendez-vous. Seulement quand la loi et la pharmacie le permettent.",
      },
    ],
  },
  app: {
    title: "L'app, pas à pas",
    lead: "Une version de poche de la pharmacie. Calme et claire, dans votre langue. Voici comment elle fonctionne.",
    play: "Lecture",
    pause: "Pause",
    caption: "Illustration avec des produits d'exemple.",
    steps: [
      {
        title: "Chercher",
        text: "Tapez un nom, une marque ou le code CNK de la boîte. Ou choisissez une catégorie.",
      },
      {
        title: "Résultats",
        text: "Vous voyez tout de suite le prix TVAC et s'il est en stock. En mots, pas seulement avec une couleur.",
      },
      {
        title: "Le produit",
        text: "Description, utilisation et mises en garde. Pour un médicament : lisez la notice et demandez conseil à votre pharmacien.",
      },
      {
        title: "Ma liste",
        text: "Ajoutez des produits à votre liste. Elle reste sur votre téléphone. Montrez-la au comptoir.",
      },
      {
        title: "Votre pharmacie",
        text: "Appeler, l'itinéraire, les heures d'ouverture. Et la pharmacie de garde et les numéros d'urgence.",
      },
      {
        title: "Commander sur le site",
        text: "La commande et le paiement se font sur la boutique. Un pharmacien y vérifie votre commande.",
      },
    ],
    screen: {
      app: "IGS-Pharma",
      search: "Produit ou code CNK",
      categories: ["Santé", "Peau", "Bébé", "Vitamines"],
      pharmacy: "Votre pharmacie",
      open: "Ouvert · appeler ou itinéraire",
      query: "crème solaire",
      results: [
        ["Crème solaire SPF 50", "14,95 €", "En stock"],
        ["Lait solaire enfant 50+", "16,50 €", "Plus que quelques-uns"],
        ["Gel après-soleil", "8,95 €", "En stock"],
      ],
      productName: ["Crème solaire SPF 50", "200 ml"],
      cnk: "CNK 1234-567 · exemple",
      price: "14,95 €",
      vat: "TVAC",
      stock: "En stock",
      productText: ["Renouveler toutes les", "2 heures. Éviter le soleil", "entre 12 et 16 h."],
      add: "Ajouter à ma liste",
      order: "Commander sur le site",
      listTitle: "Ma liste",
      listItems: [
        ["Crème solaire SPF 50", "14,95 €"],
        ["Gel après-soleil", "8,95 €"],
      ],
      listNote: "Seulement sur votre téléphone.",
      counter: "Montrer au comptoir",
      call: "Appeler",
      route: "Itinéraire",
      hours: "Heures d'ouverture",
      duty: "Pharmacie de garde",
      emergency: ["Urgence : 112", "Centre Antipoisons :", "070 245 245"],
      site: "igs-pharma.be",
      checkout: "Paiement",
      checked: ["Un pharmacien vérifie", "votre commande."],
      back: "Retour à l'app",
    },
  },
  care: {
    title: "Avec soin, dès le premier jour",
    lead: "Même sans ordonnance, un achat peut en dire long sur votre santé. C'est pourquoi IGS-Pharma est construite comme un système de soins.",
    items: [
      {
        icon: "pharmacist",
        title: "Un pharmacien veille",
        text: "Les commandes avec des médicaments sont vérifiées avant leur envoi. Pour toute question, la pharmacie est là.",
      },
      {
        icon: "leaflet",
        title: "De l'information, pas de publicité",
        text: "Une information neutre et la notice. Pas de promotions ni de notifications pour des médicaments.",
      },
      {
        icon: "lock",
        title: "Vos données sont sensibles",
        text: "Nous les traitons comme des données de santé : le moins possible, bien protégées, avec une trace de qui a fait quoi.",
      },
      {
        icon: "eu",
        title: "En Europe",
        text: "Les données de la boutique sont traitées dans l'Union européenne.",
      },
      {
        icon: "eye",
        title: "Aucun pistage",
        text: "Pas de publicité, pas d'analytics, pas de traceurs d'autres entreprises. Ni sur ce site, ni dans l'app.",
      },
      {
        icon: "speak",
        title: "Dans votre langue",
        text: "Néerlandais, français, allemand et anglais. Thème clair ou sombre, et texte plus grand dans l'app.",
      },
    ],
  },
  plan: {
    title: "Où nous en sommes",
    lead: "Nous ne donnons pas encore de date. Nous ouvrirons quand tout sera en ordre, juridiquement aussi.",
    steps: [
      {
        status: "Maintenant",
        title: "Nous construisons et testons",
        text: "La boutique et l'outil de gestion de la pharmacie existent déjà. Nous les testons avec des produits fictifs.",
      },
      {
        status: "Ensuite",
        title: "La boutique ouvre",
        text: "Après le contrôle juridique et la notification à l'AFMPS, l'autorité qui enregistre les pharmacies en ligne.",
      },
      {
        status: "Ensuite",
        title: "L'app sur Google Play",
        text: "D'abord un test avec un petit groupe, puis pour tout le monde. L'app montre les produits de la boutique.",
      },
      {
        status: "Plus tard",
        title: "Ordonnances et soins",
        text: "Réservation avec une prescription électronique, rappels et rendez-vous à la pharmacie.",
      },
    ],
  },
  privacyCard: {
    title: "La vie privée en bref",
    text: "Ce site et l'app ne vous suivent pas. L'app n'a pas de compte. Votre liste et vos réglages restent sur votre téléphone.",
    privacy: "Politique de confidentialité",
    delete: "Supprimer vos données",
  },
  site: {
    title: "Le site web",
    lead: "La boutique est un vrai site qui fonctionne. Nous la testons avec des produits inventés et elle ouvrira quand la pharmacie sera prête.",
    items: [
      {
        icon: "speak",
        title: "Dans votre langue",
        text: "Néerlandais, français, allemand et anglais, un thème clair et un thème sombre, et pensé pour le clavier et les lecteurs d'écran.",
      },
      {
        icon: "leaflet",
        title: "Prix et stock clairs",
        text: "Le prix inclut la TVA et le stock est dit en mots. Chaque produit a sa notice.",
      },
      {
        icon: "cart",
        title: "Retrait d'abord, livraison ensuite",
        text: "Retirez votre commande gratuitement à la pharmacie. La livraison à domicile par Sendcloud arrive, avec son coût affiché avant de payer.",
      },
      {
        icon: "pharmacist",
        title: "Un pharmacien veille",
        text: "Une commande contenant un médicament est vérifiée par un pharmacien avant d'être préparée.",
      },
      {
        icon: "lock",
        title: "Un back-office pour la pharmacie",
        text: "Stock avec dates de péremption, rappels de produits, prix, commandes et vérifications, pour une équipe qui se connecte avec une passkey.",
      },
      {
        icon: "eu",
        title: "Soin de vos données",
        text: "Hébergé dans l'Union européenne, sans pistage, et un accès anticipé sur invitation pendant le test.",
      },
    ],
  },
  maker: {
    kicker: "Derrière IGS-Pharma",
    title: "Construit par Ali Safari",
    lead: "Ali (ASafariM) est un développeur d'applications full-stack, propulsé par l'IA. IGS-Pharma montre ce que cela donne : une boutique, un back-office pour la pharmacie et une application Android, de la première idée à un produit soigné et testé.",
    items: [
      {
        icon: "code",
        tag: "Full stack",
        title: "De l'écran à la base de données",
        text: "Une boutique en quatre langues, un back-office, des tâches de fond, une base de données avec journal d'audit et une application Android, conçus pour fonctionner ensemble.",
      },
      {
        icon: "spark",
        tag: "Propulsé par l'IA",
        title: "Rapide, et vérifié",
        text: "Des assistants IA aident à écrire et tester le code. Des tests automatiques tournent à chaque changement et une personne le relit et le valide.",
      },
      {
        icon: "lock",
        tag: "Soigné",
        title: "Soigné dès la conception",
        text: "Connexion par passkey pour l'équipe, rôles et droits, journal d'audit et vie privée par défaut.",
      },
    ],
    stackLabel: "Outils utilisés",
    stack: [
      "Next.js",
      "React",
      "TypeScript",
      "Node.js",
      "PostgreSQL",
      "Expo et Android",
      "Docker",
      "CI/CD",
      "Développement assisté par IA",
    ],
    cta: "Plus de travaux sur asafarim.com",
  },
  faq: {
    title: "Questions",
    items: [
      {
        q: "Puis-je déjà commander ?",
        a: "Non. La boutique n'est pas encore ouverte. Elle sera sur igs-pharma.be. D'ici là, votre pharmacie vous accueille comme d'habitude.",
      },
      {
        q: "Y a-t-il un site web ?",
        a: "Oui. La boutique en ligne d'IGS-Pharma fonctionne déjà et est testée avec des produits inventés. Elle n'est pas encore ouverte. Elle sera sur igs-pharma.be. D'ici là, cette page et l'application montrent ce qui arrive.",
      },
      {
        q: "Puis-je commander des médicaments sur ordonnance ?",
        a: "Non. En Belgique, les médicaments sur ordonnance ne peuvent pas être vendus en ligne ni envoyés. Plus tard, vous pourrez les réserver avec une prescription électronique, puis les retirer et les payer à la pharmacie.",
      },
      {
        q: "Que fait l'app ?",
        a: "Chercher des produits, voir le prix et la disponibilité, lire l'information produit, faire une liste et joindre votre pharmacie. La commande se fait sur la boutique. L'app est gratuite.",
      },
      {
        q: "Ai-je besoin d'un compte ?",
        a: "Pas pour l'app. Votre liste, votre langue et votre thème restent sur votre téléphone. Sur la boutique, vous pourrez commander comme invité ou avec un compte.",
      },
      {
        q: "J'ai une question médicale.",
        a: "Demandez à votre pharmacien ou à votre médecin. En cas d'urgence : appelez le 112. En cas d'intoxication : Centre Antipoisons 070 245 245. La pharmacie de garde : pharmacie.be ou le 0903 99 000.",
      },
      {
        q: "Qui est derrière IGS-Pharma ?",
        a: "IGS-Pharma est construite par Ali Safari (ASafariM), développeur d'applications full-stack propulsé par l'IA, pour et avec une pharmacie belge. La pharmacie est le vendeur et votre prestataire de soins. Ses coordonnées (adresse, pharmacien titulaire, numéro d'autorisation) figureront sur la boutique à son ouverture.",
      },
    ],
  },
  footer: {
    tagline: "Pharmacie en ligne pour la Belgique, en construction.",
    privacy: "Confidentialité",
    cookies: "Cookies",
    delete: "Supprimer vos données",
    os: "ASafariM OS",
    maker: "Construit par ASafariM",
    rights: "ASafariM. IGS-Pharma n'est pas encore ouverte ; ce site ne vend rien.",
    emergency: "Urgence : 112 · Centre Antipoisons : 070 245 245",
  },
  back: "Retour à IGS-Pharma",
  notFound: {
    title: "Cette page n'existe pas",
    text: "Le lien est peut-être ancien ou mal tapé.",
    home: "Vers l'accueil",
  },
};

const de = {
  lang: "de-BE",
  code: "DE",
  langName: "Deutsch",
  skip: "Zum Inhalt",
  themeLabel: "Dunkles Design",
  langLabel: "Sprache",
  nav: {
    what: "Was kommt",
    site: "Die Website",
    app: "Die App",
    care: "Sorgfältig",
    plan: "Zeitplan",
    faq: "Fragen",
  },
  playSoon: "Bald bei Google Play",
  shopSoon: "Webshop: bald",
  meta: {
    title: "IGS-Pharma: Ihre Apotheke, auch online",
    description:
      "IGS-Pharma baut eine Online-Apotheke für Belgien: einen Webshop für rezeptfreie Produkte, geprüft von einem Apotheker, und eine kostenlose Android-App. Noch nicht geöffnet.",
  },
  hero: {
    kicker: "Online-Apotheke für Belgien · im Aufbau",
    title: "Ihre Apotheke, auch online.",
    lead: "IGS-Pharma bringt eine belgische Apotheke online. Einen Webshop für rezeptfreie Produkte, bei dem ein Apotheker mitschaut. Und eine kostenlose Android-App, um Produkte zu suchen und Ihre Apotheke zu erreichen.",
    note: "Wir sind noch nicht geöffnet. Sie können noch nichts bestellen.",
    cta: "Die App ansehen",
    ctaSite: "Website ansehen",
    chips: [
      "NL · FR · DE · EN",
      "Preis inkl. MwSt.",
      "Auf Lager",
      "Fragen Sie Ihren Apotheker",
      "Kostenlose App",
    ],
  },
  what: {
    title: "Was kommt",
    lead: "Eine Apotheke, zwei Wege zu ihr. Die Apotheke bleibt immer der Verkäufer und Ihr Gesundheitsdienstleister.",
    items: [
      {
        icon: "cart",
        tag: "Phase 1",
        title: "Der Webshop",
        text: "Rezeptfreie Produkte: Pflege, Baby, Vitamine, Erste Hilfe und rezeptfreie Arzneimittel. Mit der Packungsbeilage. Bestellungen mit Arzneimitteln prüft zuerst ein Apotheker.",
      },
      {
        icon: "phone",
        tag: "Phase 1",
        title: "Die Android-App",
        text: "Suchen Sie ein Produkt, sehen Sie Preis und Verfügbarkeit, setzen Sie es auf Ihre Liste und rufen Sie Ihre Apotheke an oder finden Sie sie. Bestellt wird im Webshop. Kein Konto nötig.",
      },
      {
        icon: "rx",
        tag: "Später",
        title: "Rezepte und Betreuung",
        text: "Mit einem elektronischen Rezept online reservieren, dann in der Apotheke abholen und bezahlen. Mit Erinnerungen und Terminen. Erst wenn Gesetz und Apotheke so weit sind.",
      },
    ],
  },
  app: {
    title: "Die App, Schritt für Schritt",
    lead: "Die Apotheke für die Hosentasche. Ruhig und klar, in Ihrer Sprache. So funktioniert sie.",
    play: "Abspielen",
    pause: "Pause",
    caption: "Illustration mit Beispielprodukten.",
    steps: [
      {
        title: "Suchen",
        text: "Geben Sie einen Namen, eine Marke oder den CNK-Code der Packung ein. Oder wählen Sie eine Kategorie.",
      },
      {
        title: "Ergebnisse",
        text: "Sie sehen sofort den Preis inkl. MwSt. und ob es auf Lager ist. In Worten, nicht nur als Farbe.",
      },
      {
        title: "Das Produkt",
        text: "Beschreibung, Anwendung und Warnhinweise. Bei Arzneimitteln: Lesen Sie die Packungsbeilage und fragen Sie Ihren Apotheker.",
      },
      {
        title: "Meine Liste",
        text: "Setzen Sie Produkte auf Ihre Liste. Sie bleibt auf Ihrem Telefon. Zeigen Sie sie an der Theke.",
      },
      {
        title: "Ihre Apotheke",
        text: "Anrufen, Route, Öffnungszeiten. Und die Notdienstapotheke und die Notrufnummern.",
      },
      {
        title: "Auf der Website bestellen",
        text: "Bestellen und bezahlen geschieht im Webshop. Dort prüft ein Apotheker Ihre Bestellung.",
      },
    ],
    screen: {
      app: "IGS-Pharma",
      search: "Produkt oder CNK suchen",
      categories: ["Gesundheit", "Haut", "Baby", "Vitamine"],
      pharmacy: "Ihre Apotheke",
      open: "Geöffnet · anrufen oder Route",
      query: "Sonnencreme",
      results: [
        ["Sonnencreme LSF 50", "14,95 €", "Auf Lager"],
        ["Sonnenmilch Kind LSF 50+", "16,50 €", "Nur noch wenige"],
        ["After-Sun-Gel", "8,95 €", "Auf Lager"],
      ],
      productName: ["Sonnencreme LSF 50", "200 ml"],
      cnk: "CNK 1234-567 · Beispiel",
      price: "14,95 €",
      vat: "inkl. MwSt.",
      stock: "Auf Lager",
      productText: [
        "Alle 2 Stunden erneut",
        "auftragen. Mittagssonne",
        "von 12 bis 16 Uhr meiden.",
      ],
      add: "Auf meine Liste",
      order: "Auf der Website bestellen",
      listTitle: "Meine Liste",
      listItems: [
        ["Sonnencreme LSF 50", "14,95 €"],
        ["After-Sun-Gel", "8,95 €"],
      ],
      listNote: "Nur auf Ihrem Telefon.",
      counter: "An der Theke zeigen",
      call: "Anrufen",
      route: "Route",
      hours: "Öffnungszeiten",
      duty: "Notdienstapotheke",
      emergency: ["Notfall: 112", "Giftnotrufzentrale:", "070 245 245"],
      site: "igs-pharma.be",
      checkout: "Zur Kasse",
      checked: ["Ein Apotheker prüft", "Ihre Bestellung."],
      back: "Zurück zur App",
    },
  },
  care: {
    title: "Sorgfältig, vom ersten Tag an",
    lead: "Auch ohne Rezept kann ein Kauf etwas über Ihre Gesundheit verraten. Darum bauen wir IGS-Pharma wie ein Gesundheitssystem.",
    items: [
      {
        icon: "pharmacist",
        title: "Ein Apotheker schaut mit",
        text: "Bestellungen mit Arzneimitteln werden vor dem Versand geprüft. Mit Fragen können Sie sich immer an die Apotheke wenden.",
      },
      {
        icon: "leaflet",
        title: "Information, keine Werbung",
        text: "Neutrale Produktinformation und die Packungsbeilage. Keine Aktionen oder Push-Nachrichten für Arzneimittel.",
      },
      {
        icon: "lock",
        title: "Ihre Daten sind sensibel",
        text: "Wir behandeln sie wie Gesundheitsdaten: so wenig wie möglich, gut geschützt, mit einer Spur, wer was getan hat.",
      },
      {
        icon: "eu",
        title: "In Europa",
        text: "Die Daten des Webshops werden in der Europäischen Union verarbeitet.",
      },
      {
        icon: "eye",
        title: "Kein Tracking",
        text: "Keine Werbung, keine Analytics, keine Tracker anderer Firmen. Nicht auf dieser Website, nicht in der App.",
      },
      {
        icon: "speak",
        title: "In Ihrer Sprache",
        text: "Niederländisch, Französisch, Deutsch und Englisch. Helles oder dunkles Design und größere Schrift in der App.",
      },
    ],
  },
  plan: {
    title: "Wo wir stehen",
    lead: "Ein Datum nennen wir noch nicht. Wir öffnen erst, wenn alles stimmt, auch rechtlich.",
    steps: [
      {
        status: "Jetzt",
        title: "Wir bauen und testen",
        text: "Der Webshop und die Verwaltung für die Apotheke gibt es schon. Wir testen sie mit erfundenen Produkten.",
      },
      {
        status: "Danach",
        title: "Der Webshop öffnet",
        text: "Nach der rechtlichen Prüfung und der Meldung bei der FAAG, der Behörde, die Online-Apotheken registriert.",
      },
      {
        status: "Danach",
        title: "Die App bei Google Play",
        text: "Zuerst ein Test mit einer kleinen Gruppe, dann für alle. Die App zeigt die Produkte des Webshops.",
      },
      {
        status: "Später",
        title: "Rezepte und Betreuung",
        text: "Reservieren mit einem elektronischen Rezept, Erinnerungen und Termine in der Apotheke.",
      },
    ],
  },
  privacyCard: {
    title: "Datenschutz in Kürze",
    text: "Diese Website und die App verfolgen Sie nicht. Die App hat kein Konto. Ihre Liste und Einstellungen bleiben auf Ihrem Telefon.",
    privacy: "Datenschutzerklärung",
    delete: "Ihre Daten löschen",
  },
  site: {
    title: "Die Website",
    lead: "Der Webshop ist eine echte, funktionierende Website. Wir testen ihn mit erfundenen Produkten, und er öffnet, wenn die Apotheke bereit ist.",
    items: [
      {
        icon: "speak",
        title: "In Ihrer Sprache",
        text: "Niederländisch, Französisch, Deutsch und Englisch, ein helles und ein dunkles Design, und gemacht für Tastatur und Screenreader.",
      },
      {
        icon: "leaflet",
        title: "Klare Preise und Bestände",
        text: "Der Preis enthält die MwSt., und der Bestand steht in Worten. Jedes Produkt hat seinen Beipackzettel.",
      },
      {
        icon: "cart",
        title: "Erst Abholung, dann Lieferung",
        text: "Holen Sie Ihre Bestellung kostenlos in der Apotheke ab. Die Lieferung nach Hause mit Sendcloud kommt, mit den Kosten vor dem Bezahlen.",
      },
      {
        icon: "pharmacist",
        title: "Ein Apotheker schaut mit",
        text: "Eine Bestellung mit einem Arzneimittel prüft ein Apotheker, bevor sie vorbereitet wird.",
      },
      {
        icon: "lock",
        title: "Ein Backoffice für die Apotheke",
        text: "Bestand mit Verfallsdaten, Rückrufe, Preise, Bestellungen und Prüfungen, für Mitarbeitende, die sich mit einem Passkey anmelden.",
      },
      {
        icon: "eu",
        title: "Sorgfältig mit Ihren Daten",
        text: "In der Europäischen Union gehostet, ohne Tracking, und in der Testphase ein früher Zugang nur auf Einladung.",
      },
    ],
  },
  maker: {
    kicker: "Hinter IGS-Pharma",
    title: "Gebaut von Ali Safari",
    lead: "Ali (ASafariM) ist ein Full-Stack-App-Entwickler mit KI-Unterstützung. IGS-Pharma zeigt, wie das in der Praxis aussieht: ein Webshop, ein Backoffice für die Apotheke und eine Android-App, von der ersten Idee bis zu einem sorgfältig getesteten Produkt.",
    items: [
      {
        icon: "code",
        tag: "Full Stack",
        title: "Vom Bildschirm bis zur Datenbank",
        text: "Ein Shop in vier Sprachen, ein Backoffice, Hintergrundaufgaben, eine Datenbank mit Prüfprotokoll und eine Android-App, gebaut, um zusammenzuarbeiten.",
      },
      {
        icon: "spark",
        tag: "KI-gestützt",
        title: "Schnell, und geprüft",
        text: "KI-Assistenten helfen beim Schreiben und Testen des Codes. Bei jeder Änderung laufen automatische Tests, und ein Mensch prüft und übernimmt sie.",
      },
      {
        icon: "lock",
        tag: "Sorgfältig",
        title: "Sorgfalt im Entwurf",
        text: "Anmeldung per Passkey für Mitarbeitende, Rollen und Rechte, ein Prüfprotokoll und Datenschutz als Standard.",
      },
    ],
    stackLabel: "Verwendete Werkzeuge",
    stack: [
      "Next.js",
      "React",
      "TypeScript",
      "Node.js",
      "PostgreSQL",
      "Expo und Android",
      "Docker",
      "CI/CD",
      "KI-gestützte Entwicklung",
    ],
    cta: "Mehr Arbeiten auf asafarim.com",
  },
  faq: {
    title: "Fragen",
    items: [
      {
        q: "Kann ich schon bestellen?",
        a: "Nein. Der Webshop ist noch nicht geöffnet. Er kommt auf igs-pharma.be. Bis dahin ist Ihre Apotheke wie gewohnt für Sie da.",
      },
      {
        q: "Gibt es eine Website?",
        a: "Ja. Der Webshop von IGS-Pharma funktioniert schon und wird mit erfundenen Produkten getestet. Er ist noch nicht geöffnet. Er kommt auf igs-pharma.be. Bis dahin zeigen diese Seite und die App, was kommt.",
      },
      {
        q: "Kann ich verschreibungspflichtige Arzneimittel bestellen?",
        a: "Nein. In Belgien dürfen verschreibungspflichtige Arzneimittel nicht online verkauft und verschickt werden. Später können Sie sie mit einem elektronischen Rezept reservieren und dann in der Apotheke abholen und bezahlen.",
      },
      {
        q: "Was kann die App?",
        a: "Produkte suchen, Preis und Verfügbarkeit sehen, die Produktinformation lesen, eine Liste machen und Ihre Apotheke erreichen. Bestellt wird im Webshop. Die App ist kostenlos.",
      },
      {
        q: "Brauche ich ein Konto?",
        a: "Nicht für die App. Ihre Liste, Sprache und Ihr Design bleiben auf Ihrem Telefon. Im Webshop können Sie später als Gast oder mit Konto bestellen.",
      },
      {
        q: "Ich habe eine medizinische Frage.",
        a: "Fragen Sie Ihren Apotheker oder Ihren Arzt. Im Notfall: 112 anrufen. Bei einer Vergiftung: Giftnotrufzentrale 070 245 245. Die Notdienstapotheke finden Sie unter 0903 99 000.",
      },
      {
        q: "Wer steckt dahinter?",
        a: "IGS-Pharma wird von Ali Safari (ASafariM) gebaut, einem Full-Stack-App-Entwickler mit KI-Unterstützung, für und mit einer belgischen Apotheke. Die Apotheke ist der Verkäufer und Ihr Gesundheitsdienstleister. Ihre Angaben (Adresse, Inhaber-Apotheker, Zulassungsnummer) stehen im Webshop, sobald er öffnet.",
      },
    ],
  },
  footer: {
    tagline: "Online-Apotheke für Belgien, im Aufbau.",
    privacy: "Datenschutz",
    cookies: "Cookies",
    delete: "Daten löschen",
    os: "ASafariM OS",
    maker: "Gebaut von ASafariM",
    rights: "ASafariM. IGS-Pharma ist noch nicht geöffnet; diese Website verkauft nichts.",
    emergency: "Notfall: 112 · Giftnotrufzentrale: 070 245 245",
  },
  back: "Zurück zu IGS-Pharma",
  notFound: {
    title: "Diese Seite gibt es nicht",
    text: "Vielleicht ist der Link alt oder falsch geschrieben.",
    home: "Zur Startseite",
  },
};

const en = {
  lang: "en",
  code: "EN",
  langName: "English",
  skip: "Skip to content",
  themeLabel: "Dark theme",
  langLabel: "Language",
  nav: {
    what: "What's coming",
    site: "The website",
    app: "The app",
    care: "With care",
    plan: "Timeline",
    faq: "Questions",
  },
  playSoon: "Coming soon to Google Play",
  shopSoon: "Webshop: coming soon",
  meta: {
    title: "IGS-Pharma: your pharmacy, online too",
    description:
      "IGS-Pharma is building an online pharmacy for Belgium: a webshop for non-prescription products, checked by a pharmacist, and a free Android app. Not open yet.",
  },
  hero: {
    kicker: "Online pharmacy for Belgium · being built",
    title: "Your pharmacy, online too.",
    lead: "IGS-Pharma brings a Belgian pharmacy online. A webshop for non-prescription products, with a pharmacist looking over it. And a free Android app to look up products and reach your pharmacy.",
    note: "We are not open yet. You can't order anything yet.",
    cta: "See the app",
    ctaSite: "See the website",
    chips: ["NL · FR · DE · EN", "Price incl. VAT", "In stock", "Ask your pharmacist", "Free app"],
  },
  what: {
    title: "What's coming",
    lead: "One pharmacy, two ways to reach it. The pharmacy always stays the seller and your healthcare provider.",
    items: [
      {
        icon: "cart",
        tag: "Phase 1",
        title: "The webshop",
        text: "Non-prescription products: care, baby, vitamins, first aid and over-the-counter medicines. With the leaflet. A pharmacist checks orders with medicines first.",
      },
      {
        icon: "phone",
        tag: "Phase 1",
        title: "The Android app",
        text: "Look up a product, see its price and availability, put it on your list, and call or find your pharmacy. Ordering happens in the webshop. No account needed.",
      },
      {
        icon: "rx",
        tag: "Later",
        title: "Prescriptions and care",
        text: "Reserve online with an electronic prescription, then collect and pay at the pharmacy. With reminders and appointments. Only once the law and the pharmacy are ready for it.",
      },
    ],
  },
  app: {
    title: "The app, step by step",
    lead: "A pocket version of the pharmacy. Calm and clear, in your language. This is how it works.",
    play: "Play",
    pause: "Pause",
    caption: "Illustration with example products.",
    steps: [
      {
        title: "Search",
        text: "Type a name, a brand or the CNK code on the box. Or pick a category.",
      },
      {
        title: "Results",
        text: "You see the price incl. VAT and whether it's in stock straight away. In words, not just a colour.",
      },
      {
        title: "The product",
        text: "Description, use and warnings. For medicines: read the leaflet and ask your pharmacist for advice.",
      },
      {
        title: "My list",
        text: "Put products on your list. It stays on your phone. Show it at the counter.",
      },
      {
        title: "Your pharmacy",
        text: "Call, directions, opening hours. And the pharmacy on duty and the emergency numbers.",
      },
      {
        title: "Order on the website",
        text: "Ordering and paying happen in the webshop. A pharmacist checks your order there.",
      },
    ],
    screen: {
      app: "IGS-Pharma",
      search: "Search a product or CNK",
      categories: ["Health", "Skin", "Baby", "Vitamins"],
      pharmacy: "Your pharmacy",
      open: "Open · call or get directions",
      query: "sun cream",
      results: [
        ["Sun cream SPF 50", "€14.95", "In stock"],
        ["Kids sun lotion SPF 50+", "€16.50", "Few left"],
        ["After-sun gel", "€8.95", "In stock"],
      ],
      productName: ["Sun cream SPF 50", "200 ml"],
      cnk: "CNK 1234-567 · example",
      price: "€14.95",
      vat: "incl. VAT",
      stock: "In stock",
      productText: ["Reapply every 2 hours.", "Stay out of the midday", "sun from 12 to 4 pm."],
      add: "Add to my list",
      order: "Order on the website",
      listTitle: "My list",
      listItems: [
        ["Sun cream SPF 50", "€14.95"],
        ["After-sun gel", "€8.95"],
      ],
      listNote: "Only on your phone.",
      counter: "Show at the counter",
      call: "Call",
      route: "Directions",
      hours: "Opening hours",
      duty: "Pharmacy on duty",
      emergency: ["Emergency: 112", "Poison Centre:", "070 245 245"],
      site: "igs-pharma.be",
      checkout: "Checkout",
      checked: ["A pharmacist checks", "your order."],
      back: "Back to the app",
    },
  },
  care: {
    title: "Careful, from day one",
    lead: "Even without a prescription, a purchase can say something about your health. That's why we build IGS-Pharma like a healthcare system.",
    items: [
      {
        icon: "pharmacist",
        title: "A pharmacist looks over it",
        text: "Orders with medicines are checked before they leave. With questions, you can always turn to the pharmacy.",
      },
      {
        icon: "leaflet",
        title: "Information, not advertising",
        text: "Neutral product information and the leaflet. No promotions or push messages for medicines.",
      },
      {
        icon: "lock",
        title: "Your data is sensitive",
        text: "We treat it like health data: as little as possible, well protected, with a record of who did what.",
      },
      {
        icon: "eu",
        title: "In Europe",
        text: "The webshop's data is processed in the European Union.",
      },
      {
        icon: "eye",
        title: "No tracking",
        text: "No ads, no analytics, no trackers from other companies. Not on this site, not in the app.",
      },
      {
        icon: "speak",
        title: "In your language",
        text: "Dutch, French, German and English. Light or dark theme, and larger text in the app.",
      },
    ],
  },
  plan: {
    title: "Where we are",
    lead: "We don't give a date yet. We open only when everything is right, legally too.",
    steps: [
      {
        status: "Now",
        title: "Building and testing",
        text: "The webshop and the pharmacy's back office already exist. We test them with made-up products.",
      },
      {
        status: "Next",
        title: "The webshop opens",
        text: "After the legal review and the notification to the FAMHP, the authority that registers online pharmacies.",
      },
      {
        status: "Next",
        title: "The app on Google Play",
        text: "First a test with a small group, then for everyone. The app shows the webshop's products.",
      },
      {
        status: "Later",
        title: "Prescriptions and care",
        text: "Reserving with an electronic prescription, reminders and appointments at the pharmacy.",
      },
    ],
  },
  privacyCard: {
    title: "Privacy in short",
    text: "This website and the app don't track you. The app has no account. Your list and settings stay on your phone.",
    privacy: "Privacy policy",
    delete: "Delete your data",
  },
  site: {
    title: "The website",
    lead: "The webshop is a real, working website. We test it with invented products and it opens when the pharmacy is ready.",
    items: [
      {
        icon: "speak",
        title: "In your language",
        text: "Dutch, French, German and English, a light and a dark theme, and built to be used with a keyboard and a screen reader.",
      },
      {
        icon: "leaflet",
        title: "Clear prices and stock",
        text: "The price includes VAT and the stock is told in words. Every product has its leaflet.",
      },
      {
        icon: "cart",
        title: "Pickup now, delivery next",
        text: "Collect your order at the pharmacy for free. Home delivery by Sendcloud is coming, with its cost shown before you pay.",
      },
      {
        icon: "pharmacist",
        title: "A pharmacist looks over it",
        text: "An order with a medicine is checked by a pharmacist before it is prepared.",
      },
      {
        icon: "lock",
        title: "A back-office for the pharmacy",
        text: "Stock with expiry dates, recalls, prices, orders and reviews, for staff who sign in with a passkey.",
      },
      {
        icon: "eu",
        title: "Careful with your data",
        text: "Hosted in the European Union, no tracking, and an invitation-only early access while it is in test.",
      },
    ],
  },
  maker: {
    kicker: "Behind IGS-Pharma",
    title: "Built by Ali Safari",
    lead: "Ali (ASafariM) is a full-stack, AI-powered app developer. IGS-Pharma is what that looks like at work: a webshop, a pharmacy back-office and an Android app, from the first idea to a careful, tested product.",
    items: [
      {
        icon: "code",
        tag: "Full stack",
        title: "From screen to database",
        text: "A storefront in four languages, a back-office, background jobs, a database with an audit trail and an Android app, built to work together.",
      },
      {
        icon: "spark",
        tag: "AI-powered",
        title: "Fast, and checked",
        text: "AI assistants help write and test the code. Automated tests run on every change and a person reviews and merges it.",
      },
      {
        icon: "lock",
        tag: "Careful",
        title: "Careful by design",
        text: "Passkey sign-in for staff, roles and permissions, an audit trail and privacy by default.",
      },
    ],
    stackLabel: "Tools used",
    stack: [
      "Next.js",
      "React",
      "TypeScript",
      "Node.js",
      "PostgreSQL",
      "Expo and Android",
      "Docker",
      "CI/CD",
      "AI-assisted engineering",
    ],
    cta: "More work on asafarim.com",
  },
  faq: {
    title: "Questions",
    items: [
      {
        q: "Can I order yet?",
        a: "No. The webshop is not open yet. It will be at igs-pharma.be. Until then, your pharmacy is there for you as usual.",
      },
      {
        q: "Is there a website?",
        a: "Yes. The IGS-Pharma webshop already works and is being tested with invented products. It is not open yet. It will be at igs-pharma.be. Until then, this page and the app show what is coming.",
      },
      {
        q: "Can I order prescription medicines?",
        a: "No. In Belgium, prescription medicines may not be sold online or shipped. Later you will be able to reserve them with an electronic prescription, then collect and pay for them at the pharmacy.",
      },
      {
        q: "What does the app do?",
        a: "Look up products, see the price and availability, read the product information, make a list and reach your pharmacy. Ordering happens in the webshop. The app is free.",
      },
      {
        q: "Do I need an account?",
        a: "Not for the app. Your list, language and theme stay on your phone. In the webshop you will be able to order as a guest or with an account.",
      },
      {
        q: "I have a medical question.",
        a: "Ask your pharmacist or your doctor. In an emergency: call 112. For a poisoning: Poison Centre 070 245 245. Find the pharmacy on duty at pharmacie.be or apotheek.be, or call 0903 99 000.",
      },
      {
        q: "Who is behind it?",
        a: "IGS-Pharma is built by Ali Safari (ASafariM), a full-stack, AI-powered app developer, for and with a Belgian pharmacy. The pharmacy is the seller and your healthcare provider. Its details (address, pharmacist-titular, authorisation number) will be on the webshop when it opens.",
      },
    ],
  },
  footer: {
    tagline: "Online pharmacy for Belgium, being built.",
    privacy: "Privacy",
    cookies: "Cookies",
    delete: "Delete your data",
    os: "ASafariM OS",
    maker: "Built by ASafariM",
    rights: "ASafariM. IGS-Pharma is not open yet; this site sells nothing.",
    emergency: "Emergency: 112 · Poison Centre: 070 245 245",
  },
  back: "Back to IGS-Pharma",
  notFound: {
    title: "This page doesn't exist",
    text: "The link may be old or mistyped.",
    home: "Go to the home page",
  },
};

export const languages = { nl, fr, de, en };
