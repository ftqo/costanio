import { Trans } from "@lingui/react/macro";
import { A, B, Bullets, LegalDoc, P, type LegalSection } from "@/components/LegalDoc";

const CONTACT = "brian@ftqo.dev";

const SECTIONS: LegalSection[] = [
  {
    id: "who",
    title: "Who we are",
    body: (
      <P>
        Costanio (the <B>“Service”</B>, at <B>costan.io</B>) is operated by Brian (<B>“ftqo”</B>),
        an individual, who is the data controller for personal data processed through the Service.
        Contact: <A href={`mailto:${CONTACT}`}>{CONTACT}</A>. This policy explains what we collect,
        why, and the choices you have.
      </P>
    ),
  },
  {
    id: "collect",
    title: "What we collect",
    body: (
      <>
        <P>We collect only what we need to run a multiplayer game. Specifically:</P>
        <Bullets
          items={[
            <>
              <B>Discord login</B> (if you use it): your Discord user ID, username, and avatar (the{" "}
              <span className="font-mono">identify</span> scope). If supporter sync is enabled, we
              read your roles in our Discord server to determine supporter status. We do <B>not</B>{" "}
              request your email or guild list, and the optional friends feature (which would read
              your Discord relationships) is off by default.
            </>,
            <>
              <B>Google login</B> (if you use it): your Google account ID, email address, name, and
              profile picture (the <span className="font-mono">openid email profile</span> scopes).
            </>,
            <>
              <B>Guest play</B>: only the display name you choose. Guests have no email and no
              external identity.
            </>,
            <>
              <B>Gameplay data</B>: games you join, your moves (stored as an event log), in-game
              chat messages, ratings, statistics, and replays.
            </>,
            <>
              <B>Feedback</B> (if you send it): your message and the page you sent it from. It is
              posted to a private channel on our Discord server so the team can read it.
            </>,
            <>
              <B>Supporter and cosmetics data</B>: supporter status, the cosmetic items you own or
              have equipped, and your earned in-game currency ledger.
            </>,
            <>
              <B>Technical data</B>: your IP address and basic request logs, kept for security,
              abuse and rate-limit enforcement, and debugging. We may also use analytics and, in the
              future, advertising cookies. See <A href="#cookies">Cookies and local storage</A>{" "}
              below.
            </>,
          ]}
        />
        <P>
          <B>Payments.</B> If you support us, payment is handled entirely by the provider you choose
          (e.g. Ko-fi or Discord). We never see or store your card or bank details; we only learn
          that an account holds supporter status.
        </P>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and local storage",
    body: (
      <>
        <P>
          We use a single <B>essential session cookie</B> (an opaque, random token, set{" "}
          <B>HttpOnly</B>, <B>Secure</B>, and <B>SameSite=Lax</B>) to keep you signed in. The
          Service does not work without it. We also store small non-personal preferences (such as
          your light/dark theme) in your browser’s local storage.
        </P>
        <P>
          We may also use <B>analytics cookies</B> to understand how the Service is used, and we may
          in the future use <B>advertising cookies</B>, including from third-party partners, to show
          or measure ads. These are <B>non-essential</B>. Where the law requires it (for example in
          the EEA and UK), we will ask for your <B>consent</B> before setting non-essential cookies,
          and you can change or withdraw that choice at any time. Where applicable, you may also opt
          out as described in <A href="#rights">Your rights</A> below. We will update this policy
          before relying on any advertising cookies.
        </P>
      </>
    ),
  },
  {
    id: "use",
    title: "How we use your data",
    body: (
      <Bullets
        items={[
          <>Authenticate you and keep you signed in.</>,
          <>Run games: matchmaking, turns, chat, reconnection, and saving game state.</>,
          <>Maintain ratings, statistics, leaderboards, and replays.</>,
          <>Grant and sync supporter perks and cosmetic items.</>,
          <>Protect the Service: prevent abuse, cheating, spam, and fraud, and enforce limits.</>,
          <>Diagnose problems and improve the Service.</>,
          <>Measure how the Service is used and, where you consent, show or measure advertising.</>,
          <>Respond to you when you contact us.</>,
        ]}
      />
    ),
  },
  {
    id: "bases",
    title: "Legal bases (EEA/UK)",
    body: (
      <P>
        If you are in the European Economic Area or the UK, we process your data to{" "}
        <B>perform our contract</B> with you (providing the Service you asked for), on the basis of
        our <B>legitimate interests</B> (keeping the Service secure and functional), and, where
        applicable, with your <B>consent</B> (for example, before we set non-essential analytics or
        advertising cookies, which you may withdraw at any time). Where we rely on legitimate
        interests, we balance them against your rights.
      </P>
    ),
  },
  {
    id: "sharing",
    title: "How we share data",
    body: (
      <>
        <P>
          <B>We do not currently sell your personal data.</B> We share it only as needed to run the
          Service:
        </P>
        <Bullets
          items={[
            <>
              <B>Other players</B> see your public profile: display name, avatar, ratings/stats, and
              your in-game chat and moves in games you join.
            </>,
            <>
              <B>Login providers</B> (Discord, Google) when you choose to sign in with them.
            </>,
            <>
              <B>Payment providers</B> (e.g. Ko-fi, Discord) if you choose to support us.
            </>,
            <>
              <B>Infrastructure providers</B> that host and deliver the Service (for example,
              Cloudflare for content delivery and DDoS protection, and our server host).
            </>,
            <>
              <B>Legal reasons</B>: to comply with law, enforce our Terms, or protect the rights,
              safety, and security of users and the Service.
            </>,
          ]}
        />
        <P>
          If we introduce advertising in the future, sharing data with advertising partners may
          count as a <B>“sale” or “sharing”</B> under some laws (such as California’s). We will
          update this policy and offer the opt-out described in <A href="#rights">Your rights</A>{" "}
          before doing so.
        </P>
      </>
    ),
  },
  {
    id: "retention",
    title: "Data retention",
    body: (
      <P>
        We keep account data for as long as your account exists. Sessions expire after a period of
        inactivity. Game event logs, ratings, and replays are retained to preserve game integrity
        and history. Guest data exists only in your browser cookie and is effectively gone once you
        clear it. We retain limited technical logs for a short period for security and debugging.
        When you delete your account, we delete or anonymize associated personal data, except where
        we must keep it to comply with law or resolve disputes.
      </P>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <P>
          Depending on where you live (including under the EU/UK GDPR and the California CCPA/CPRA),
          you may have the right to:
        </P>
        <Bullets
          items={[
            <>Access the personal data we hold about you and get a copy.</>,
            <>Correct inaccurate data, or delete your data.</>,
            <>Object to or restrict certain processing, and withdraw consent.</>,
            <>Data portability, where applicable.</>,
            <>
              Opt out of any “sale” or “sharing” of personal data for cross-context behavioral
              advertising.
            </>,
            <>Not be discriminated against for exercising these rights.</>,
          ]}
        />
        <P>
          To exercise any of these, including a{" "}
          <B>“Do Not Sell or Share My Personal Information”</B> request, email{" "}
          <A href={`mailto:${CONTACT}`}>{CONTACT}</A>. We do not currently sell or “share” personal
          data for cross-context behavioral advertising; if that changes, this opt-out will apply
          and we will make it available before any such use. EEA/UK users may also complain to their
          local data protection authority.
        </P>
      </>
    ),
  },
  {
    id: "security",
    title: "Security",
    body: (
      <P>
        We take reasonable measures to protect your data: encrypted connections (HTTPS), opaque
        session tokens rather than long-lived credentials, and secrets kept encrypted at rest. No
        system is perfectly secure, however, and we cannot guarantee absolute security.
      </P>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <P>
        The Service is intended for users aged <B>16 and over</B>. It is not directed to children
        under 16, and we do not knowingly collect personal data from them. If you believe a child
        under 16 has provided us personal data, contact <A href={`mailto:${CONTACT}`}>{CONTACT}</A>{" "}
        and we will delete it.
      </P>
    ),
  },
  {
    id: "transfers",
    title: "International data transfers",
    body: (
      <P>
        The Service is operated from, and data is processed and stored in, the United States. If you
        access it from elsewhere, you understand your data will be transferred to and processed in
        the United States and other countries where we or our providers operate, which may have
        different data-protection laws than your own.
      </P>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <P>
        We may update this Privacy Policy from time to time. When we do, we will revise the “Last
        updated” date above and make material changes reasonably prominent. Continuing to use the
        Service after an update means you accept the revised policy.
      </P>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <P>
        Questions or requests about your privacy? Email <A href={`mailto:${CONTACT}`}>{CONTACT}</A>.
        See also our <A href="/terms">Terms of Service</A>.
      </P>
    ),
  },
];

export function Privacy() {
  return (
    <LegalDoc
      title={<Trans>Privacy Policy</Trans>}
      updated="2026-06-23"
      intro={
        <P>
          This Privacy Policy explains what personal data Costanio (<B>costan.io</B>) collects, how
          we use and share it, and the choices you have. By using the Service you agree to this
          policy. It works alongside our <A href="/terms">Terms of Service</A>.
        </P>
      }
      sections={SECTIONS}
    />
  );
}
