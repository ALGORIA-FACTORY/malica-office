import { createFileRoute, Link } from "@tanstack/react-router";

/**
 * La politique de confidentialité — la page publique que Google Play exige,
 * et que la convention de pilote cite.
 *
 * Elle dit ce que l'application collecte, pourquoi, chez qui cela passe et
 * combien de temps cela reste. En français, en arabe et en anglais sur la même page :
 * une adresse unique, lisible par tous ceux à qui elle s'adresse. Elle ne
 * promet rien que le code ne tienne : les sous-traitants nommés sont ceux de
 * `infra/`, les durées celles de R7 et de la loi.
 */
export const Route = createFileRoute("/confidentialite")({
  head: () => ({
    meta: [
      { title: "Politique de confidentialité — Malica Office" },
      {
        name: "description",
        content:
          "Ce que Malica Office collecte, pourquoi, chez qui les données passent, et combien de temps elles restent.",
      },
    ],
  }),
  component: Confidentialite,
});

const MISE_A_JOUR = "6 septembre 2026";
const CONTACT = "hello@algoria-factory.com";

function Confidentialite() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="rule-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link to="/" className="text-sm font-semibold uppercase tracking-[0.2em]">
            Malica Office
          </Link>
          <span className="text-xs text-muted-foreground">Mise à jour : {MISE_A_JOUR}</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <article lang="fr" className="space-y-6 text-[15px] leading-relaxed">
          <h1 className="text-3xl font-semibold tracking-tight">Politique de confidentialité</h1>
          <p>
            Malica Office est une application de comptabilité pour les petites et moyennes
            entreprises, tenue avec leur cabinet d'expertise comptable. Elle est éditée par{" "}
            <strong>Algoria Factory</strong> (Tunisie). Cette page dit ce que l'application
            collecte, pourquoi, chez qui les données passent, et combien de temps elles restent.
          </p>

          <Section titre="Ce que nous collectons">
            <ul className="list-disc space-y-2 ps-6">
              <li>
                <strong>Votre compte</strong> : adresse e-mail, nom affiché, mot de passe (haché,
                jamais lisible), et les organisations auxquelles vous appartenez.
              </li>
              <li>
                <strong>Vos pièces</strong> : les factures, tickets, reçus et documents que vous
                photographiez ou déposez, avec ce que l'application en lit (montants, dates,
                émetteur, lignes) et les écritures comptables qui en découlent.
              </li>
              <li>
                <strong>Vos échanges</strong> : les questions posées à Malica sur votre dossier, les
                réponses, et les messages avec votre cabinet.
              </li>
              <li>
                <strong>Le fonctionnement</strong> : les signalements que vous envoyez depuis les
                réglages (écran, version, appareil) et, lorsque la télémétrie est activée, les
                rapports de plantage — sans contenu de pièce, sans adresse IP.
              </li>
            </ul>
            <p>
              L'application accède à la <strong>caméra</strong> pour photographier vos documents, et
              au <strong>stockage de l'appareil</strong> pour garder vos photos en attente lorsque
              le réseau manque. Elle n'accède ni à vos contacts, ni à votre position, ni à vos
              autres fichiers.
            </p>
          </Section>

          <Section titre="Pourquoi">
            <p>
              Pour tenir votre comptabilité : lire vos pièces, proposer les écritures, calculer la
              TVA et les échéances, et les soumettre à votre cabinet qui supervise et tranche. Les
              montants qui vous engagent sortent toujours d'un calcul déterministe, jamais d'un
              modèle de langage ; chaque montant porte la citation de la zone du document d'où il
              vient.
            </p>
          </Section>

          <Section titre="Chez qui les données passent">
            <p>
              Vos données sont hébergées chez <strong>Hetzner</strong> (Allemagne), chiffrées en
              transit et sauvegardées chiffrées hors site (Hetzner Storage Box, Allemagne). Pour
              lire une pièce, son image est transmise à un service de reconnaissance de texte (
              <strong>Alibaba Cloud Model Studio</strong>, Singapour) puis à un modèle de langage (
              <strong>DeepSeek</strong>) qui en structure le contenu ; ces services ne conservent
              pas vos documents au-delà du traitement, selon leurs conditions. Lorsque la télémétrie
              est activée, les rapports de plantage vont chez <strong>Sentry</strong> (Union
              européenne) ; les mises à jour de l'application passent par <strong>Capgo</strong>{" "}
              (Union européenne) et <strong>Google Play</strong>. Aucune donnée n'est vendue ni
              cédée à des fins publicitaires.
            </p>
          </Section>

          <Section titre="Qui y accède">
            <p>
              Vous, et les personnes de votre cabinet à qui vous avez confié votre dossier. Chaque
              accès est cloisonné dans la base de données : une entreprise ne voit jamais les
              données d'une autre. L'équipe d'Algoria Factory n'accède aux données qu'en cas
              d'incident technique, sur demande, et le consigne.
            </p>
          </Section>

          <Section titre="Combien de temps">
            <p>
              Les pièces comptables et les écritures sont conservées <strong>dix ans</strong>, durée
              légale d'archivage des documents comptables. Les photos en attente sur l'appareil sont
              effacées dès qu'elles sont envoyées. Les signalements et rapports de plantage sont
              conservés douze mois. Un compte fermé est supprimé avec ses données personnelles ; les
              pièces comptables restent archivées pour le compte de l'entreprise, jusqu'au terme
              légal.
            </p>
          </Section>

          <Section titre="Vos droits">
            <p>
              Conformément à la loi organique n° 2004-63 relative à la protection des données à
              caractère personnel, vous pouvez accéder à vos données, les faire corriger, vous
              opposer à un traitement ou demander la suppression de ce qui n'est pas soumis à une
              obligation légale de conservation. Écrivez à{" "}
              <a className="underline" href={`mailto:${CONTACT}`}>
                {CONTACT}
              </a>
              . Nous répondons sous trente jours.
            </p>
          </Section>

          <Section titre="En cas d'incident">
            <p>
              Si un incident touchait vos données, votre cabinet et vous en seriez informés sous
              soixante-douze heures, avec ce qui s'est passé et ce qui a été fait.
            </p>
          </Section>

          <Section id="suppression" titre="Demander la suppression de vos données">
            <p>
              Pour demander la suppression de vos données dans Malica Office, éditée par Algoria
              Factory :
            </p>
            <ol className="list-decimal space-y-2 ps-6">
              <li>
                Écrivez à{" "}
                <a
                  className="underline"
                  href={`mailto:${CONTACT}?subject=Suppression%20de%20mes%20donn%C3%A9es`}
                >
                  {CONTACT}
                </a>{" "}
                depuis l'adresse e-mail de votre compte, avec l'objet « Suppression de mes données
                ».
              </li>
              <li>
                Nous vérifions que la demande vient bien du titulaire du compte, puis nous
                confirmons la suppression par retour d'e-mail, sous trente jours au plus.
              </li>
            </ol>
            <p>
              <strong>Ce qui est supprimé</strong> : votre compte, votre adresse e-mail, votre nom
              affiché, vos échanges avec Malica et votre cabinet, vos signalements et les rapports
              de plantage qui vous concernent, ainsi que les photos en attente sur votre appareil
              (effacées à la désinstallation).
            </p>
            <p>
              <strong>Ce qui est conservé</strong> : les pièces comptables et les écritures de
              l'entreprise, que la loi oblige à archiver dix ans ; elles restent au nom de
              l'entreprise, sans lien avec votre compte. Vous pouvez aussi ne demander que la
              suppression d'une partie de vos données : dites-le dans votre message.
            </p>
          </Section>
        </article>

        <hr className="my-12 border-border" />

        <article lang="ar" dir="rtl" className="space-y-6 text-[15px] leading-relaxed">
          <h1 className="text-3xl font-semibold tracking-tight">سياسة الخصوصية</h1>
          <p>
            ماليكا أوفيس تطبيق محاسبة للمؤسسات الصغيرة والمتوسطة، يُمسَك مع مكتب الخبرة المحاسبية.
            تنشره <strong>Algoria Factory</strong> (تونس). تبيّن هذه الصفحة ما يجمعه التطبيق،
            ولماذا، وعند من تمرّ البيانات، وكم تبقى.
          </p>

          <Section titre="ما نجمعه">
            <ul className="list-disc space-y-2 ps-6">
              <li>
                <strong>حسابك</strong>: البريد الإلكتروني، الاسم المعروض، كلمة المرور (مشفّرة، لا
                تُقرأ أبدًا)، والمؤسسات التي تنتمي إليها.
              </li>
              <li>
                <strong>وثائقك</strong>: الفواتير والتذاكر والإيصالات التي تصوّرها أو تودعها، وما
                يقرأه التطبيق منها (المبالغ، التواريخ، المصدر، السطور) والقيود المحاسبية الناتجة
                عنها.
              </li>
              <li>
                <strong>مراسلاتك</strong>: أسئلتك لماليكا عن ملفك، والأجوبة، والرسائل مع مكتبك.
              </li>
              <li>
                <strong>التشغيل</strong>: البلاغات التي ترسلها من الإعدادات (الشاشة، الإصدار،
                الجهاز)، وعند تفعيل القياس عن بُعد، تقارير الأعطال — بلا محتوى وثيقة وبلا عنوان IP.
              </li>
            </ul>
            <p>
              يصل التطبيق إلى <strong>الكاميرا</strong> لتصوير وثائقك، وإلى{" "}
              <strong>ذاكرة الجهاز</strong> لحفظ صورك في الانتظار عند غياب الشبكة. لا يصل إلى جهات
              اتصالك ولا موقعك ولا ملفاتك الأخرى.
            </p>
          </Section>

          <Section titre="لماذا">
            <p>
              لمسك محاسبتك: قراءة وثائقك، اقتراح القيود، حساب الأداء على القيمة المضافة والآجال،
              وعرضها على مكتبك الذي يراقب ويقرّر. المبالغ الملزِمة تصدر دائمًا عن حساب حتمي، لا عن
              نموذج لغوي؛ وكل مبلغ يحمل الإحالة إلى موضعه في الوثيقة.
            </p>
          </Section>

          <Section titre="عند من تمرّ البيانات">
            <p>
              تُستضاف بياناتك لدى <strong>Hetzner</strong> (ألمانيا)، مشفّرة أثناء النقل ومحفوظة
              مشفّرة خارج الموقع (Hetzner Storage Box، ألمانيا). لقراءة وثيقة، تُرسل صورتها إلى خدمة
              تعرّف على النص (<strong>Alibaba Cloud Model Studio</strong>، سنغافورة) ثم إلى نموذج
              لغوي (<strong>DeepSeek</strong>) يهيكل محتواها؛ لا تحتفظ هذه الخدمات بوثائقك بعد
              المعالجة وفق شروطها. عند تفعيل القياس عن بُعد تذهب تقارير الأعطال إلى{" "}
              <strong>Sentry</strong> (الاتحاد الأوروبي)؛ وتمرّ تحديثات التطبيق عبر{" "}
              <strong>Capgo</strong> (الاتحاد الأوروبي) و<strong>Google Play</strong>. لا تُباع أي
              بيانات ولا تُمنح لأغراض إعلانية.
            </p>
          </Section>

          <Section titre="من يطّلع عليها">
            <p>
              أنت، وأشخاص مكتبك الذين عهدت إليهم بملفك. كل وصول معزول في قاعدة البيانات: لا ترى
              مؤسسة بيانات مؤسسة أخرى. لا يصل فريق Algoria Factory إلى البيانات إلا عند حادث تقني،
              بطلب، ويدوّن ذلك.
            </p>
          </Section>

          <Section titre="كم تبقى">
            <p>
              تُحفظ الوثائق المحاسبية والقيود <strong>عشر سنوات</strong>، وهي المدة القانونية لأرشفة
              الوثائق المحاسبية. تُمحى الصور المنتظرة على الجهاز فور إرسالها. تُحفظ البلاغات وتقارير
              الأعطال اثني عشر شهرًا. يُحذف الحساب المغلق مع بياناته الشخصية؛ وتبقى الوثائق
              المحاسبية مؤرشفة لحساب المؤسسة حتى انقضاء الأجل القانوني.
            </p>
          </Section>

          <Section titre="حقوقك">
            <p>
              وفق القانون الأساسي عدد 63 لسنة 2004 المتعلق بحماية المعطيات الشخصية، يمكنك الاطلاع
              على بياناتك وتصحيحها والاعتراض على معالجة وطلب حذف ما لا يخضع لواجب حفظ قانوني. راسلنا
              على{" "}
              <a className="underline" href={`mailto:${CONTACT}`} dir="ltr">
                {CONTACT}
              </a>
              . نجيب خلال ثلاثين يومًا.
            </p>
          </Section>

          <Section titre="عند وقوع حادث">
            <p>
              إذا مسّ حادث بياناتك، يُعلَم مكتبك وأنت خلال اثنتين وسبعين ساعة، بما وقع وما تم فعله.
            </p>
          </Section>

          <Section id="حذف" titre="طلب حذف بياناتك">
            <p>لطلب حذف بياناتك من ماليكا أوفيس، الذي تنشره Algoria Factory:</p>
            <ol className="list-decimal space-y-2 ps-6">
              <li>
                راسل{" "}
                <a
                  className="underline"
                  href={`mailto:${CONTACT}?subject=Suppression%20de%20mes%20donn%C3%A9es`}
                  dir="ltr"
                >
                  {CONTACT}
                </a>{" "}
                من عنوان البريد الإلكتروني لحسابك، بعنوان «حذف بياناتي».
              </li>
              <li>
                نتحقق من أن الطلب صادر عن صاحب الحساب، ثم نؤكد الحذف بالبريد الإلكتروني خلال ثلاثين
                يومًا على الأكثر.
              </li>
            </ol>
            <p>
              <strong>ما يُحذف</strong>: حسابك، بريدك الإلكتروني، اسمك المعروض، مراسلاتك مع ماليكا
              ومكتبك، بلاغاتك وتقارير الأعطال المتعلقة بك، والصور المنتظرة على جهازك (تُمحى عند
              إزالة التطبيق).
            </p>
            <p>
              <strong>ما يُحتفظ به</strong>: الوثائق المحاسبية وقيود المؤسسة، التي يُلزم القانون
              بأرشفتها عشر سنوات؛ تبقى باسم المؤسسة دون ارتباط بحسابك. يمكنك أيضًا طلب حذف جزء من
              بياناتك فقط: اذكر ذلك في رسالتك.
            </p>
          </Section>
        </article>
        <hr className="my-12 border-border" />

        {/*
         * La version anglaise suit le texte français, qui fait foi. Traduction
         * à faire valider avant de la citer dans un contrat.
         */}
        <article lang="en" className="space-y-6 text-[15px] leading-relaxed">
          <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
          <p>
            Malica Office is an accounting application for small and medium-sized businesses, kept
            together with their accounting firm. It is published by <strong>Algoria Factory</strong>{" "}
            (Tunisia). This page states what the application collects, why, who processes the data,
            and how long it is kept. The French version above prevails.
          </p>

          <Section titre="What we collect">
            <ul className="list-disc space-y-2 ps-6">
              <li>
                <strong>Your account</strong>: email address, display name, password (hashed, never
                readable), and the organisations you belong to.
              </li>
              <li>
                <strong>Your documents</strong>: the invoices, tickets, receipts and documents you
                photograph or upload, with what the application reads from them (amounts, dates,
                issuer, lines) and the accounting entries that follow from them.
              </li>
              <li>
                <strong>Your conversations</strong>: the questions you ask Malica about your file,
                the answers, and your messages with your firm.
              </li>
              <li>
                <strong>Operation</strong>: the reports you send from the settings (screen, version,
                device) and, when telemetry is enabled, crash reports — with no document content and
                no IP address.
              </li>
            </ul>
            <p>
              The application uses the <strong>camera</strong> to photograph your documents, and the{" "}
              <strong>device storage</strong> to keep your pending photos when the network is
              unavailable. It does not access your contacts, your location or your other files.
            </p>
          </Section>

          <Section titre="Why">
            <p>
              To keep your accounts: read your documents, propose the entries, compute VAT and
              deadlines, and submit them to your firm, which supervises and decides. The amounts
              that bind you always come from a deterministic calculation, never from a language
              model; each amount cites the area of the document it comes from.
            </p>
          </Section>

          <Section titre="Who processes the data">
            <p>
              Your data is hosted by <strong>Hetzner</strong> (Germany), encrypted in transit and
              backed up encrypted off-site (Hetzner Storage Box, Germany). To read a document, its
              image is sent to a text-recognition service (
              <strong>Alibaba Cloud Model Studio</strong>, Singapore) and then to a language model (
              <strong>DeepSeek</strong>) that structures its content; these services do not keep
              your documents beyond processing, under their terms. When telemetry is enabled, crash
              reports go to <strong>Sentry</strong> (European Union); application updates go through{" "}
              <strong>Capgo</strong> (European Union) and <strong>Google Play</strong>. No data is
              sold or transferred for advertising purposes.
            </p>
          </Section>

          <Section titre="Who has access">
            <p>
              You, and the people at your firm to whom you have entrusted your file. Every access is
              partitioned in the database: one company never sees another&apos;s data. The Algoria
              Factory team accesses data only in the event of a technical incident, on request, and
              records it.
            </p>
          </Section>

          <Section titre="How long">
            <p>
              Accounting documents and entries are kept for <strong>ten years</strong>, the legal
              retention period for accounting records. Pending photos on the device are erased as
              soon as they are sent. Reports and crash reports are kept for twelve months. A closed
              account is deleted with its personal data; accounting documents remain archived on
              behalf of the company until the legal term.
            </p>
          </Section>

          <Section titre="Your rights">
            <p>
              Under Organic Law No. 2004-63 on the protection of personal data, you may access your
              data, have it corrected, object to processing, or request the deletion of anything not
              subject to a legal retention obligation. Write to{" "}
              <a className="underline" href={`mailto:${CONTACT}`}>
                {CONTACT}
              </a>
              . We reply within thirty days.
            </p>
          </Section>

          <Section titre="In case of an incident">
            <p>
              If an incident affected your data, you and your firm would be informed within
              seventy-two hours, with what happened and what was done.
            </p>
          </Section>

          <Section id="deletion" titre="Request the deletion of your data">
            <p>
              To request the deletion of your data in Malica Office, published by Algoria Factory:
            </p>
            <ol className="list-decimal space-y-2 ps-6">
              <li>
                Write to{" "}
                <a className="underline" href={`mailto:${CONTACT}?subject=Delete%20my%20data`}>
                  {CONTACT}
                </a>{" "}
                from your account&apos;s email address, with the subject “Delete my data”.
              </li>
              <li>
                We check that the request comes from the account holder, then confirm the deletion
                by email, within thirty days at most.
              </li>
            </ol>
            <p>
              <strong>What is deleted</strong>: your account, your email address, your display name,
              your conversations with Malica and your firm, your reports and the crash reports that
              concern you, as well as the pending photos on your device (erased on uninstall).
            </p>
            <p>
              <strong>What is kept</strong>: the company&apos;s accounting documents and entries,
              which the law requires to be archived for ten years; they remain in the company&apos;s
              name, with no link to your account. You may also request the deletion of only part of
              your data: say so in your message.
            </p>
          </Section>
        </article>
      </main>

      <footer className="rule-t">
        <div className="mx-auto max-w-3xl px-6 py-6 text-xs text-muted-foreground">
          Malica Office · Algoria Factory · {CONTACT}
        </div>
      </footer>
    </div>
  );
}

function Section({
  id,
  titre,
  children,
}: {
  id?: string;
  titre: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <h2 className="text-lg font-semibold">{titre}</h2>
      {children}
    </section>
  );
}
