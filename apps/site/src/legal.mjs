// Privacy policy, cookie policy and "delete your data" for this site and the phase-1 Android app
// (Google Play needs a privacy policy URL that works while the storefront is gated). Drafted for Ali's
// review (October 2026): not legal advice.
// It must always match what the site and the app really do. The app (asafarim-docs
// ventures/igs-pharma/09-mobile) has no account; it sends only search words and product codes (CNK) to
// the storefront API and keeps language, theme, text size and My list on the phone. Update this text
// (and the Play Data safety form) before the app gets sign-in, ordering, notifications or analytics.
// The webshop itself gets its own privacy policy from the pharmacy, on igs-pharma.be.
import { CONTACT_EMAIL, POLICY_UPDATED } from "./content.mjs";

const mail = `<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>`;

export const privacy = {
  nl: {
    title: "Privacybeleid",
    draft: "Ontwerp: deze tekst wordt nog juridisch nagekeken.",
    updated: `Laatst bijgewerkt: ${POLICY_UPDATED}`,
    sections: [
      [
        "Waarover dit gaat",
        [
          `Over deze website (igs.asafarim.site) en de IGS-Pharma-app voor Android. Beide worden gemaakt door ASafariM in België. Vragen over uw gegevens? Mail naar ${mail}.`,
          "De webshop op igs-pharma.be krijgt een eigen privacybeleid van de apotheek, die dan verantwoordelijk is voor uw bestellingen.",
        ],
      ],
      [
        "Kort",
        [
          "Geen account, geen advertenties, geen analytics, geen trackers. De app stuurt alleen wat nodig is om producten te tonen, en niets dat naar u wijst.",
        ],
      ],
      [
        "Wat de app naar ons stuurt",
        [
          {
            list: [
              "<strong>Zoekwoorden en productcodes.</strong> Wat u typt in het zoekvak, de CNK-code of categorie van wat u opent, en het nummer van de barcode die u scant. Zo kan de webshop de juiste producten, prijzen en beschikbaarheid terugsturen.",
              "<strong>Uw taal.</strong> Zodat u de productinformatie in uw taal krijgt.",
            ],
          },
          "Dat gaat naar de server van de webshop (igs-pharma.be), in de Europese Unie. Het is niet gekoppeld aan uw naam, een account of een toestel-id. We bewaren uw zoekwoorden niet bij de verzoeken in onze logs.",
          "Zoals elke server ziet ook de onze uw IP-adres. We gebruiken het alleen om de pagina of het antwoord te sturen en om de dienst te beschermen tegen misbruik.",
        ],
      ],
      [
        "Wat de app op uw telefoon bewaart",
        [
          {
            list: [
              "<strong>Mijn lijstje.</strong> De producten die u bewaarde, met de prijs van de laatste keer.",
              "<strong>Uw instellingen.</strong> Taal, thema en tekstgrootte.",
            ],
          },
          "Dat blijft op uw telefoon. Wij kunnen het niet zien.",
        ],
      ],
      [
        "Wat we nooit verzamelen",
        [
          {
            list: [
              "Uw naam, e-mailadres, telefoonnummer of een account.",
              "Uw voorschriften, diagnoses of andere gezondheidsgegevens.",
              "Uw locatie, contacten, foto's of microfoon. “Route” opent uw kaarten-app met het adres van de apotheek; de app leest uw locatie niet.",
              "Beelden van de camera. De camera werkt alleen op het scherm “Scannen”, nadat u hem toestaat, om de barcode van een verpakking te lezen. Dat gebeurt op uw telefoon; er wordt geen foto bewaard of verstuurd.",
              "Een advertentie-id. Er zijn geen advertenties.",
              "Gegevens voor tracking of analytics, van ons of van andere bedrijven.",
            ],
          },
        ],
      ],
      [
        "Bellen, mailen en de website",
        [
          "Als u in de app op “Bellen”, een e-mailadres of “Bestellen op de website” tikt, opent uw telefoon de telefoon-, e-mail- of browserapp. Wat daarna gebeurt, valt onder die apps en, voor de webshop, onder het privacybeleid van de apotheek.",
        ],
      ],
      [
        "Uw gegevens verwijderen",
        [
          'Alles wat de app bewaart, staat op uw telefoon. Zie <a href="{{deleteHref}}">Uw gegevens verwijderen</a>.',
        ],
      ],
      [
        "Uw rechten",
        [
          `U heeft het recht op inzage, verbetering en verwijdering van uw gegevens. Mail naar ${mail}.`,
          'Niet tevreden? Dan kan u een klacht indienen bij de <a href="https://www.gegevensbeschermingsautoriteit.be/">Gegevensbeschermingsautoriteit</a>.',
        ],
      ],
      [
        "Deze website",
        [
          'Deze website gebruikt geen analytics en geen tracking. Er is één cookie: <code>asafarim-theme</code>, dat onthoudt of u het lichte of het donkere thema koos. Zie het <a href="{{cookiesHref}}">cookiebeleid</a>.',
        ],
      ],
      [
        "Wijzigingen",
        [
          "Komen er later een account, bestellen in de app of meldingen, dan passen we dit beleid eerst aan en zeggen we in de app wat er verandert.",
        ],
      ],
    ],
  },
  fr: {
    title: "Politique de confidentialité",
    draft: "Projet : ce texte doit encore être relu par un juriste.",
    updated: `Dernière mise à jour : ${POLICY_UPDATED}`,
    sections: [
      [
        "De quoi il s'agit",
        [
          `De ce site (igs.asafarim.site) et de l'app IGS-Pharma pour Android. Les deux sont réalisés par ASafariM en Belgique. Une question sur vos données ? Écrivez à ${mail}.`,
          "La boutique sur igs-pharma.be aura sa propre politique de confidentialité, de la pharmacie, qui sera alors responsable de vos commandes.",
        ],
      ],
      [
        "En bref",
        [
          "Pas de compte, pas de publicité, pas d'analytics, pas de traceurs. L'app n'envoie que ce qu'il faut pour afficher les produits, et rien qui permette de vous identifier.",
        ],
      ],
      [
        "Ce que l'app nous envoie",
        [
          {
            list: [
              "<strong>Mots recherchés et codes produit.</strong> Ce que vous tapez dans la recherche, le code CNK ou la catégorie de ce que vous ouvrez, et le numéro du code-barres que vous scannez. La boutique peut ainsi renvoyer les bons produits, prix et disponibilités.",
              "<strong>Votre langue.</strong> Pour recevoir l'information produit dans votre langue.",
            ],
          },
          "Ces données vont au serveur de la boutique (igs-pharma.be), dans l'Union européenne. Elles ne sont liées ni à votre nom, ni à un compte, ni à un identifiant d'appareil. Nous ne gardons pas vos mots recherchés avec les requêtes dans nos journaux.",
          "Comme tout serveur, le nôtre voit votre adresse IP. Nous l'utilisons seulement pour envoyer la page ou la réponse et pour protéger le service contre les abus.",
        ],
      ],
      [
        "Ce que l'app garde sur votre téléphone",
        [
          {
            list: [
              "<strong>Ma liste.</strong> Les produits que vous avez gardés, avec le prix de la dernière consultation.",
              "<strong>Vos réglages.</strong> Langue, thème et taille du texte.",
            ],
          },
          "Cela reste sur votre téléphone. Nous ne pouvons pas le voir.",
        ],
      ],
      [
        "Ce que nous ne collectons jamais",
        [
          {
            list: [
              "Votre nom, adresse e-mail, numéro de téléphone ou un compte.",
              "Vos ordonnances, diagnostics ou autres données de santé.",
              "Votre position, vos contacts, photos ou micro. « Itinéraire » ouvre votre app de cartes avec l'adresse de la pharmacie ; l'app ne lit pas votre position.",
              "Les images de la caméra. La caméra ne fonctionne que sur l'écran « Scanner », après votre accord, pour lire le code-barres d'un emballage. Cela se passe sur votre téléphone ; aucune photo n'est gardée ni envoyée.",
              "Un identifiant publicitaire. Il n'y a pas de publicité.",
              "Des données de pistage ou d'analytics, de notre part ou d'autres entreprises.",
            ],
          },
        ],
      ],
      [
        "Appeler, écrire et le site",
        [
          "Quand vous touchez « Appeler », une adresse e-mail ou « Commander sur le site » dans l'app, votre téléphone ouvre l'app téléphone, e-mail ou navigateur. La suite relève de ces apps et, pour la boutique, de la politique de confidentialité de la pharmacie.",
        ],
      ],
      [
        "Supprimer vos données",
        [
          'Tout ce que l\'app garde est sur votre téléphone. Voir <a href="{{deleteHref}}">Supprimer vos données</a>.',
        ],
      ],
      [
        "Vos droits",
        [
          `Vous avez le droit d'accéder à vos données, de les corriger et de les faire supprimer. Écrivez à ${mail}.`,
          'Pas satisfait ? Vous pouvez porter plainte auprès de l\'<a href="https://www.autoriteprotectiondonnees.be/">Autorité de protection des données</a>.',
        ],
      ],
      [
        "Ce site",
        [
          'Ce site n\'utilise ni analytics ni pistage. Il a un seul cookie, <code>asafarim-theme</code>, qui retient si vous avez choisi le thème clair ou sombre. Voir la <a href="{{cookiesHref}}">politique en matière de cookies</a>.',
        ],
      ],
      [
        "Modifications",
        [
          "Si un compte, la commande dans l'app ou des notifications arrivent plus tard, nous adapterons d'abord cette politique et l'app dira ce qui change.",
        ],
      ],
    ],
  },
  de: {
    title: "Datenschutzerklärung",
    draft: "Entwurf: Dieser Text wird noch rechtlich geprüft.",
    updated: `Zuletzt aktualisiert: ${POLICY_UPDATED}`,
    sections: [
      [
        "Worum es geht",
        [
          `Um diese Website (igs.asafarim.site) und die IGS-Pharma-App für Android. Beide werden von ASafariM in Belgien gemacht. Fragen zu Ihren Daten? Schreiben Sie an ${mail}.`,
          "Der Webshop auf igs-pharma.be bekommt eine eigene Datenschutzerklärung der Apotheke, die dann für Ihre Bestellungen verantwortlich ist.",
        ],
      ],
      [
        "Kurz",
        [
          "Kein Konto, keine Werbung, keine Analytics, keine Tracker. Die App sendet nur, was nötig ist, um Produkte zu zeigen, und nichts, was auf Sie verweist.",
        ],
      ],
      [
        "Was die App an uns sendet",
        [
          {
            list: [
              "<strong>Suchwörter und Produktcodes.</strong> Was Sie in die Suche eingeben, den CNK-Code oder die Kategorie dessen, was Sie öffnen, und die Nummer des Barcodes, den Sie scannen. So kann der Webshop die richtigen Produkte, Preise und Verfügbarkeiten zurücksenden.",
              "<strong>Ihre Sprache.</strong> Damit Sie die Produktinformation in Ihrer Sprache bekommen.",
            ],
          },
          "Das geht an den Server des Webshops (igs-pharma.be) in der Europäischen Union. Es ist nicht mit Ihrem Namen, einem Konto oder einer Geräte-ID verbunden. Wir speichern Ihre Suchwörter nicht mit den Anfragen in unseren Protokollen.",
          "Wie jeder Server sieht auch unserer Ihre IP-Adresse. Wir nutzen sie nur, um die Seite oder Antwort zu senden und den Dienst vor Missbrauch zu schützen.",
        ],
      ],
      [
        "Was die App auf Ihrem Telefon speichert",
        [
          {
            list: [
              "<strong>Meine Liste.</strong> Die Produkte, die Sie gespeichert haben, mit dem Preis vom letzten Mal.",
              "<strong>Ihre Einstellungen.</strong> Sprache, Design und Schriftgröße.",
            ],
          },
          "Das bleibt auf Ihrem Telefon. Wir können es nicht sehen.",
        ],
      ],
      [
        "Was wir nie erheben",
        [
          {
            list: [
              "Ihren Namen, Ihre E-Mail-Adresse, Telefonnummer oder ein Konto.",
              "Ihre Rezepte, Diagnosen oder andere Gesundheitsdaten.",
              "Ihren Standort, Kontakte, Fotos oder Mikrofon. „Route“ öffnet Ihre Karten-App mit der Adresse der Apotheke; die App liest Ihren Standort nicht.",
              "Kamerabilder. Die Kamera läuft nur auf dem Bildschirm „Scannen“, nachdem Sie sie erlaubt haben, um den Barcode einer Packung zu lesen. Das geschieht auf Ihrem Telefon; es wird kein Foto gespeichert oder gesendet.",
              "Eine Werbe-ID. Es gibt keine Werbung.",
              "Daten für Tracking oder Analytics, von uns oder anderen Firmen.",
            ],
          },
        ],
      ],
      [
        "Anrufen, E-Mail und die Website",
        [
          "Wenn Sie in der App auf „Anrufen“, eine E-Mail-Adresse oder „Auf der Website bestellen“ tippen, öffnet Ihr Telefon die Telefon-, E-Mail- oder Browser-App. Was danach geschieht, fällt unter diese Apps und, für den Webshop, unter die Datenschutzerklärung der Apotheke.",
        ],
      ],
      [
        "Ihre Daten löschen",
        [
          'Alles, was die App speichert, ist auf Ihrem Telefon. Siehe <a href="{{deleteHref}}">Ihre Daten löschen</a>.',
        ],
      ],
      [
        "Ihre Rechte",
        [
          `Sie haben das Recht auf Auskunft, Berichtigung und Löschung Ihrer Daten. Schreiben Sie an ${mail}.`,
          'Nicht zufrieden? Sie können sich bei der belgischen <a href="https://www.dataprotectionauthority.be/">Datenschutzbehörde</a> beschweren.',
        ],
      ],
      [
        "Diese Website",
        [
          'Diese Website nutzt keine Analytics und kein Tracking. Es gibt ein Cookie, <code>asafarim-theme</code>, das sich merkt, ob Sie das helle oder das dunkle Design gewählt haben. Siehe die <a href="{{cookiesHref}}">Cookie-Richtlinie</a>.',
        ],
      ],
      [
        "Änderungen",
        [
          "Kommen später ein Konto, Bestellen in der App oder Benachrichtigungen, passen wir zuerst diese Erklärung an und sagen in der App, was sich ändert.",
        ],
      ],
    ],
  },
  en: {
    title: "Privacy policy",
    draft: "Draft: this text is still to be reviewed by a lawyer.",
    updated: `Last updated: ${POLICY_UPDATED}`,
    sections: [
      [
        "What this covers",
        [
          `This website (igs.asafarim.site) and the IGS-Pharma app for Android. Both are made by ASafariM in Belgium. Questions about your data? Email ${mail}.`,
          "The webshop at igs-pharma.be will have its own privacy policy from the pharmacy, which is then responsible for your orders.",
        ],
      ],
      [
        "In short",
        [
          "No account, no ads, no analytics, no trackers. The app sends only what it needs to show products, and nothing that points to you.",
        ],
      ],
      [
        "What the app sends us",
        [
          {
            list: [
              "<strong>Search words and product codes.</strong> What you type in the search box, the CNK code or category of what you open, and the number of a barcode you scan. That lets the webshop send back the right products, prices and availability.",
              "<strong>Your language.</strong> So you get the product information in your language.",
            ],
          },
          "This goes to the webshop's server (igs-pharma.be), in the European Union. It is not linked to your name, an account or a device id. We don't keep your search words with the requests in our logs.",
          "Like every server, ours sees your IP address. We use it only to send the page or answer and to protect the service against abuse.",
        ],
      ],
      [
        "What the app keeps on your phone",
        [
          {
            list: [
              "<strong>My list.</strong> The products you saved, with the price from the last time you looked.",
              "<strong>Your settings.</strong> Language, theme and text size.",
            ],
          },
          "This stays on your phone. We can't see it.",
        ],
      ],
      [
        "What we never collect",
        [
          {
            list: [
              "Your name, email address, phone number or an account.",
              "Your prescriptions, diagnoses or any other health data.",
              "Your location, contacts, photos or microphone. “Directions” opens your maps app with the pharmacy's address; the app doesn't read your location.",
              "Camera images. The camera only runs on the “Scan” screen, after you allow it, to read a pack's barcode. That happens on your phone; no photo is kept or sent.",
              "An advertising id. There are no ads.",
              "Data for tracking or analytics, by us or by other companies.",
            ],
          },
        ],
      ],
      [
        "Calling, email and the website",
        [
          "When you tap “Call”, an email address or “Order on the website” in the app, your phone opens its phone, email or browser app. What happens next falls under those apps and, for the webshop, under the pharmacy's privacy policy.",
        ],
      ],
      [
        "Deleting your data",
        [
          'Everything the app keeps is on your phone. See <a href="{{deleteHref}}">Delete your data</a>.',
        ],
      ],
      [
        "Your rights",
        [
          `You have the right to access, correct and delete your data. Email ${mail}.`,
          'Not happy? You can complain to the Belgian <a href="https://www.dataprotectionauthority.be/">Data Protection Authority</a>.',
        ],
      ],
      [
        "This website",
        [
          'This website uses no analytics and no tracking. There is one cookie, <code>asafarim-theme</code>, which remembers whether you chose the light or the dark theme. See the <a href="{{cookiesHref}}">cookie policy</a>.',
        ],
      ],
      [
        "Changes",
        [
          "If sign-in, ordering in the app or notifications arrive later, we update this policy first and the app says what changes.",
        ],
      ],
    ],
  },
};

export const deletion = {
  nl: {
    title: "Uw gegevens verwijderen",
    lead: "De IGS-Pharma-app heeft geen account. Alles wat de app bewaart, staat op uw telefoon. Zo verwijdert u het.",
    sections: [
      [
        "In de app",
        [
          "Open Mijn lijstje en tik op “Lijstje leegmaken”. Taal, thema en tekstgrootte kan u elk apart wijzigen in Instellingen.",
        ],
      ],
      [
        "Alles in één keer",
        [
          {
            ordered: [
              "Open de Instellingen van uw telefoon.",
              "Ga naar Apps en kies IGS-Pharma.",
              "Tik op Opslag en dan op Opslag wissen. Of verwijder de app.",
            ],
          },
          "Dan zijn uw lijstje en uw instellingen (taal, thema, tekstgrootte) weg.",
        ],
      ],
      [
        "Bij ons",
        [
          `Wij bewaren niets dat naar u wijst, dus er is bij ons niets te verwijderen. Vragen? Mail naar ${mail}.`,
          "Komt er later een account, dan kan u het in de app verwijderen. Deze pagina legt dan uit hoe.",
        ],
      ],
    ],
  },
  fr: {
    title: "Supprimer vos données",
    lead: "L'app IGS-Pharma n'a pas de compte. Tout ce qu'elle garde est sur votre téléphone. Voici comment le supprimer.",
    sections: [
      [
        "Dans l'app",
        [
          "Ouvrez Ma liste et touchez « Vider la liste ». La langue, le thème et la taille du texte se changent chacun dans Réglages.",
        ],
      ],
      [
        "Tout en une fois",
        [
          {
            ordered: [
              "Ouvrez les Paramètres de votre téléphone.",
              "Allez dans Applications et choisissez IGS-Pharma.",
              "Touchez Stockage, puis Vider le stockage. Ou désinstallez l'app.",
            ],
          },
          "Votre liste et vos réglages (langue, thème, taille du texte) sont alors effacés.",
        ],
      ],
      [
        "Chez nous",
        [
          `Nous ne gardons rien qui permette de vous identifier : il n'y a donc rien à supprimer chez nous. Une question ? Écrivez à ${mail}.`,
          "Si un compte arrive plus tard, vous pourrez le supprimer dans l'app. Cette page expliquera alors comment.",
        ],
      ],
    ],
  },
  de: {
    title: "Ihre Daten löschen",
    lead: "Die IGS-Pharma-App hat kein Konto. Alles, was sie speichert, ist auf Ihrem Telefon. So löschen Sie es.",
    sections: [
      [
        "In der App",
        [
          "Öffnen Sie Meine Liste und tippen Sie auf „Liste leeren“. Sprache, Design und Schriftgröße ändern Sie jeweils unter Einstellungen.",
        ],
      ],
      [
        "Alles auf einmal",
        [
          {
            ordered: [
              "Öffnen Sie die Einstellungen Ihres Telefons.",
              "Gehen Sie zu Apps und wählen Sie IGS-Pharma.",
              "Tippen Sie auf Speicher und dann auf Speicherinhalt löschen. Oder deinstallieren Sie die App.",
            ],
          },
          "Dann sind Ihre Liste und Ihre Einstellungen (Sprache, Design, Schriftgröße) gelöscht.",
        ],
      ],
      [
        "Bei uns",
        [
          `Wir speichern nichts, was auf Sie verweist, also gibt es bei uns nichts zu löschen. Fragen? Schreiben Sie an ${mail}.`,
          "Kommt später ein Konto, können Sie es in der App löschen. Diese Seite erklärt dann, wie.",
        ],
      ],
    ],
  },
  en: {
    title: "Delete your data",
    lead: "The IGS-Pharma app has no account. Everything it keeps is on your phone. Here's how to remove it.",
    sections: [
      [
        "In the app",
        [
          "Open My list and tap “Clear the list”. Language, theme and text size can each be changed in Settings.",
        ],
      ],
      [
        "Everything at once",
        [
          {
            ordered: [
              "Open your phone's Settings.",
              "Go to Apps and choose IGS-Pharma.",
              "Tap Storage, then Clear storage. Or uninstall the app.",
            ],
          },
          "Your list and your settings (language, theme, text size) are then gone.",
        ],
      ],
      [
        "With us",
        [
          `We keep nothing that points to you, so there is nothing to delete on our side. Questions? Email ${mail}.`,
          "If an account arrives later, you will be able to delete it in the app. This page will then explain how.",
        ],
      ],
    ],
  },
};

export const cookies = {
  nl: {
    title: "Cookiebeleid",
    updated: `Laatst bijgewerkt: ${POLICY_UPDATED}`,
    lead: "Kort: deze website heeft één cookie, en dat onthoudt alleen uw thema. Geen tracking, geen advertenties, geen cookies van andere bedrijven. Daarom is er ook geen cookiemelding.",
    sections: [
      [
        "Wat is een cookie?",
        [
          "Een cookie is een klein stukje tekst dat een website in uw browser bewaart en later terugleest.",
        ],
      ],
      [
        "Het enige cookie",
        [
          {
            list: [
              "<strong>Naam:</strong> <code>asafarim-theme</code>",
              "<strong>Waarvoor:</strong> onthoudt of u het lichte of het donkere thema koos. Het wordt pas gezet als u zelf op de themaknop drukt.",
              "<strong>Waar:</strong> igs.asafarim.site en de andere ASafariM-sites op asafarim.site, zodat uw keuze overal geldt.",
              "<strong>Hoe lang:</strong> 1 jaar.",
              "<strong>Wat het bevat:</strong> alleen <code>light</code> of <code>dark</code>. Niets over u.",
            ],
          },
          "Omdat u dit cookie zelf vraagt door een thema te kiezen, mag het volgens de Belgische wet zonder toestemming. U kan het altijd wissen in de instellingen van uw browser: dan volgt de site weer het thema van uw toestel.",
        ],
      ],
      [
        "De app",
        [
          'De IGS-Pharma-app gebruikt geen cookies. Uw lijstje en instellingen staan alleen op uw telefoon. Lees meer in het <a href="{{privacyHref}}">privacybeleid</a>.',
        ],
      ],
      [
        "De webshop",
        ["De webshop op igs-pharma.be krijgt een eigen cookiebeleid van de apotheek."],
      ],
      ["Vragen?", [`Mail naar ${mail}.`]],
    ],
  },
  fr: {
    title: "Politique en matière de cookies",
    updated: `Dernière mise à jour : ${POLICY_UPDATED}`,
    lead: "En bref : ce site a un seul cookie, qui retient seulement votre thème. Pas de pistage, pas de publicité, pas de cookies d'autres entreprises. C'est pourquoi il n'y a pas de bandeau cookies.",
    sections: [
      [
        "Qu'est-ce qu'un cookie ?",
        ["Un cookie est un petit texte qu'un site garde dans votre navigateur et relit plus tard."],
      ],
      [
        "Le seul cookie",
        [
          {
            list: [
              "<strong>Nom :</strong> <code>asafarim-theme</code>",
              "<strong>À quoi il sert :</strong> retenir si vous avez choisi le thème clair ou sombre. Il n'est posé que quand vous appuyez vous-même sur le bouton de thème.",
              "<strong>Où :</strong> igs.asafarim.site et les autres sites ASafariM sur asafarim.site, pour que votre choix vaille partout.",
              "<strong>Durée :</strong> 1 an.",
              "<strong>Contenu :</strong> seulement <code>light</code> ou <code>dark</code>. Rien sur vous.",
            ],
          },
          "Comme vous demandez ce cookie vous-même en choisissant un thème, la loi belge l'autorise sans consentement. Vous pouvez l'effacer à tout moment dans les réglages de votre navigateur : le site suit alors de nouveau le thème de votre appareil.",
        ],
      ],
      [
        "L'app",
        [
          "L'app IGS-Pharma n'utilise pas de cookies. Votre liste et vos réglages sont seulement sur votre téléphone. Plus d'infos dans la <a href=\"{{privacyHref}}\">politique de confidentialité</a>.",
        ],
      ],
      [
        "La boutique",
        [
          "La boutique sur igs-pharma.be aura sa propre politique en matière de cookies, de la pharmacie.",
        ],
      ],
      ["Des questions ?", [`Écrivez à ${mail}.`]],
    ],
  },
  de: {
    title: "Cookie-Richtlinie",
    updated: `Zuletzt aktualisiert: ${POLICY_UPDATED}`,
    lead: "Kurz: Diese Website hat ein Cookie, und es merkt sich nur Ihr Design. Kein Tracking, keine Werbung, keine Cookies anderer Firmen. Darum gibt es auch keinen Cookie-Hinweis.",
    sections: [
      [
        "Was ist ein Cookie?",
        [
          "Ein Cookie ist ein kleines Stück Text, das eine Website in Ihrem Browser speichert und später wieder liest.",
        ],
      ],
      [
        "Das einzige Cookie",
        [
          {
            list: [
              "<strong>Name:</strong> <code>asafarim-theme</code>",
              "<strong>Wofür:</strong> merkt sich, ob Sie das helle oder das dunkle Design gewählt haben. Es wird erst gesetzt, wenn Sie selbst auf den Design-Knopf drücken.",
              "<strong>Wo:</strong> igs.asafarim.site und die anderen ASafariM-Websites auf asafarim.site, damit Ihre Wahl überall gilt.",
              "<strong>Wie lange:</strong> 1 Jahr.",
              "<strong>Inhalt:</strong> nur <code>light</code> oder <code>dark</code>. Nichts über Sie.",
            ],
          },
          "Weil Sie dieses Cookie selbst anfordern, indem Sie ein Design wählen, ist es nach belgischem Recht ohne Einwilligung erlaubt. Sie können es jederzeit in den Einstellungen Ihres Browsers löschen: Die Website folgt dann wieder dem Design Ihres Geräts.",
        ],
      ],
      [
        "Die App",
        [
          'Die IGS-Pharma-App nutzt keine Cookies. Ihre Liste und Einstellungen sind nur auf Ihrem Telefon. Mehr in der <a href="{{privacyHref}}">Datenschutzerklärung</a>.',
        ],
      ],
      [
        "Der Webshop",
        ["Der Webshop auf igs-pharma.be bekommt eine eigene Cookie-Richtlinie der Apotheke."],
      ],
      ["Fragen?", [`Schreiben Sie an ${mail}.`]],
    ],
  },
  en: {
    title: "Cookie policy",
    updated: `Last updated: ${POLICY_UPDATED}`,
    lead: "In short: this website has one cookie, and it only remembers your theme. No tracking, no ads, no cookies from other companies. That's why there is no cookie banner.",
    sections: [
      [
        "What is a cookie?",
        ["A cookie is a small piece of text a website keeps in your browser and reads back later."],
      ],
      [
        "The only cookie",
        [
          {
            list: [
              "<strong>Name:</strong> <code>asafarim-theme</code>",
              "<strong>What for:</strong> remembers whether you chose the light or the dark theme. It is only set when you press the theme button yourself.",
              "<strong>Where:</strong> igs.asafarim.site and the other ASafariM sites on asafarim.site, so your choice holds everywhere.",
              "<strong>How long:</strong> 1 year.",
              "<strong>What it holds:</strong> only <code>light</code> or <code>dark</code>. Nothing about you.",
            ],
          },
          "Because you ask for this cookie yourself by choosing a theme, Belgian law allows it without consent. You can delete it in your browser settings at any time: the site then follows your device's theme again.",
        ],
      ],
      [
        "The app",
        [
          'The IGS-Pharma app uses no cookies. Your list and settings are only on your phone. Read more in the <a href="{{privacyHref}}">privacy policy</a>.',
        ],
      ],
      [
        "The webshop",
        ["The webshop at igs-pharma.be will have its own cookie policy from the pharmacy."],
      ],
      ["Questions?", [`Email ${mail}.`]],
    ],
  },
};
