import { Trans } from "@lingui/react/macro";
import { A, B, Bullets, LegalDoc, P, type LegalSection } from "@/components/LegalDoc";

const CONTACT = "brian@ftqo.dev";

const SECTIONS: LegalSection[] = [
  {
    id: "who",
    title: "Who we are",
    body: (
      <>
        <P>
          Costanio (the <B>“Service”</B>) is a free, browser-based multiplayer board game operated
          by Brian (<B>“ftqo”</B>), an individual (<B>“we”</B>, <B>“us”</B>), reachable at{" "}
          <A href={`mailto:${CONTACT}`}>{CONTACT}</A>. By using the Service you agree to these
          Terms. If you do not agree, do not use the Service.
        </P>
        <P>
          The Service is an <B>independent, community-funded project</B> and a generic
          settlement-and-trading game. It is{" "}
          <B>not affiliated with, sponsored by, or endorsed by</B> Catan GmbH, Catan Studio,
          Asmodee, or any other rights holder. We make no claim to any third party’s trademarks;
          board-game mechanics are not protected by copyright and are not owned by us, and the
          Service deliberately uses only generic, non-trademarked names.
        </P>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "Eligibility",
    body: (
      <P>
        You must be at least <B>16 years old</B> to use the Service (and old enough to use any login
        provider you choose, e.g. Discord or Google). If you are under the age of majority where you
        live, you may use the Service only with the involvement of a parent or guardian. By using
        the Service you represent that you meet these requirements.
      </P>
    ),
  },
  {
    id: "accounts",
    title: "Accounts and login",
    body: (
      <>
        <P>
          You can sign in with Discord or Google, or play as a guest from an invite link. You are
          responsible for activity under your account and for keeping access to it secure. One
          person per account; do not share, sell, or transfer accounts, and do not impersonate
          anyone.
        </P>
        <Bullets
          items={[
            <>
              <B>Guest accounts</B> live only in your browser cookie. Clearing it orphans that
              identity, and its games and any progress become unrecoverable.
            </>,
            <>
              We use opaque session cookies that expire after a period of inactivity. We may revoke
              any session at any time.
            </>,
            <>
              You may stop using the Service at any time. To request deletion of your account and
              associated personal data, contact <A href={`mailto:${CONTACT}`}>{CONTACT}</A> (see our{" "}
              <A href="/privacy">Privacy Policy</A>).
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "conduct",
    title: "Acceptable use",
    body: (
      <>
        <P>You agree not to:</P>
        <Bullets
          items={[
            <>
              Cheat, exploit bugs, manipulate ratings, or use bots, scripts, or automation to gain
              an unfair advantage or to play on your behalf.
            </>,
            <>
              Harass, threaten, defame, or abuse other players, or post hateful, obscene, or illegal
              content in chat, display names, custom maps, or anywhere else.
            </>,
            <>
              Disrupt or overload the Service, including denial-of-service attempts, circumventing
              rate limits, mass account creation, or unauthorized scraping or access.
            </>,
            <>
              Reverse engineer, probe, or attempt to access non-public areas except as permitted by
              law, or interfere with security features.
            </>,
            <>Use the Service to violate any law or the rights of others.</>,
          ]}
        />
        <P>
          We may remove content, reset ratings, or suspend or terminate access for conduct we
          reasonably believe violates these Terms or harms other players or the Service.
        </P>
      </>
    ),
  },
  {
    id: "content",
    title: "Your content",
    body: (
      <P>
        You retain ownership of content you submit (chat messages, display names, custom maps, and
        the like). You grant us a worldwide, non-exclusive, royalty-free license to host, store,
        reproduce, and display that content <B>solely to operate and provide the Service</B> (for
        example, showing your messages to other players in your game, or your map to players who use
        it). You are responsible for your content and represent that you have the right to submit
        it. We may remove content that violates these Terms.
      </P>
    ),
  },
  {
    id: "virtual",
    title: "Supporter status and virtual items",
    body: (
      <>
        <P>
          The Service is free to play. Optional <B>supporter</B> contributions (for example via
          Ko-fi or Discord) unlock <B>cosmetic-only</B> perks. Supporting never buys a gameplay
          advantage. There is no pay-to-win, and purchased or earned items never affect ranked play.
        </P>
        <Bullets
          items={[
            <>
              <B>Billing is handled by third parties</B> (e.g. Ko-fi, Discord). Their terms and
              payment processing govern your subscription, renewals, and cancellation. You can
              cancel a recurring contribution at any time through that provider.
            </>,
            <>
              <B>In-game currency and cosmetics have no monetary value</B>, cannot be exchanged for
              cash, and are non-transferable. They are a limited, revocable license to use features
              within the Service, not property you own.
            </>,
            <>
              We may add, change, retire, or re-price items and supporter perks. If your supporter
              status lapses, you keep cosmetics and currency you already used or were granted; only
              ongoing benefits (future stipends, the live rotating set, the expanded palette in new
              games) stop.
            </>,
            <>
              Except where required by law or by the payment provider’s policies, contributions are{" "}
              <B>non-refundable</B>.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "availability",
    title: "Availability and changes",
    body: (
      <P>
        The Service is provided on an evolving, best-effort basis and is under active development.
        We may change, suspend, or discontinue any part of it (including games in progress, ratings,
        maps, or features) at any time, with or without notice. We do not guarantee uptime, that
        games or data will be preserved, or that the Service will be error-free.
      </P>
    ),
  },
  {
    id: "ip",
    title: "Intellectual property",
    body: (
      <>
        <P>
          The Service’s software, design, text, and original artwork are owned by us or our
          licensors and protected by law. Subject to these Terms, we grant you a personal,
          non-exclusive, non-transferable, revocable license to access and use the Service for your
          own non-commercial enjoyment. You may not copy, modify, distribute, or create derivative
          works from the Service except as the law allows or as we permit in writing.
        </P>
        <P>
          We respect intellectual property and expect you to as well. We claim no ownership of, and
          assert no rights in, any third party’s trademarks or copyrighted material; the Service is
          an independent work that implements only generic, unprotected game mechanics under
          de-branded names. If you believe content on the Service infringes your rights, see the{" "}
          <A href="#dmca">copyright complaints</A> section below.
        </P>
      </>
    ),
  },
  {
    id: "dmca",
    title: "Copyright complaints (DMCA)",
    body: (
      <>
        <P>
          We respond to clear notices of alleged copyright infringement under the U.S. Digital
          Millennium Copyright Act (DMCA) and may remove material and disable accounts of repeat
          infringers. To report content you believe infringes your copyright (for example, in a
          user-submitted custom map or chat), send a written notice to{" "}
          <A href={`mailto:${CONTACT}`}>{CONTACT}</A> including:
        </P>
        <Bullets
          items={[
            <>Your physical or electronic signature.</>,
            <>Identification of the copyrighted work you claim was infringed.</>,
            <>
              Identification of the infringing material and enough detail to locate it on the
              Service.
            </>,
            <>Your name, address, phone number, and email.</>,
            <>
              A statement that you have a good-faith belief the use is not authorized by the
              copyright owner, its agent, or the law.
            </>,
            <>
              A statement, under penalty of perjury, that the information is accurate and that you
              are the owner or authorized to act on the owner’s behalf.
            </>,
          ]}
        />
        <P>
          If your material was removed and you believe that was a mistake or misidentification, you
          may send a counter-notice to the same address. We will act on valid notices and
          counter-notices as the DMCA requires.
        </P>
      </>
    ),
  },
  {
    id: "termination",
    title: "Suspension and termination",
    body: (
      <P>
        We may suspend or terminate your access at any time, with or without notice, including for
        violations of these Terms. You may stop using the Service at any time. Sections that by
        their nature should survive termination (including content licenses you have granted,
        disclaimers, limitation of liability, indemnification, and governing law) survive.
      </P>
    ),
  },
  {
    id: "disclaimer",
    title: "Disclaimers",
    body: (
      <P>
        THE SERVICE IS PROVIDED <B>“AS IS” AND “AS AVAILABLE,”</B> WITHOUT WARRANTIES OF ANY KIND,
        WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY,
        FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE
        WILL BE UNINTERRUPTED, SECURE, OR ERROR-FREE, OR THAT DATA WILL NOT BE LOST. SOME
        JURISDICTIONS DO NOT ALLOW CERTAIN DISCLAIMERS, SO SOME OF THE ABOVE MAY NOT APPLY TO YOU.
      </P>
    ),
  },
  {
    id: "liability",
    title: "Limitation of liability",
    body: (
      <P>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL,
        SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF DATA, GAMES, PROGRESS, OR
        GOODWILL, ARISING FROM OR RELATED TO YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ALL
        CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF (A) THE AMOUNT YOU PAID US IN
        THE 12 MONTHS BEFORE THE CLAIM, OR (B) USD $50. BECAUSE THE SERVICE IS PROVIDED FREE OF
        CHARGE, FOR MOST USERS THIS AMOUNT IS ZERO. YOU USE THE SERVICE AT YOUR OWN RISK, AND TO THE
        FULLEST EXTENT PERMITTED BY LAW YOU RELEASE US FROM ALL CLAIMS ARISING OUT OF YOUR USE OF
        THE SERVICE OR THE CONDUCT OF OTHER USERS. SOME JURISDICTIONS DO NOT ALLOW THESE LIMITS, SO
        THEY MAY NOT FULLY APPLY TO YOU.
      </P>
    ),
  },
  {
    id: "indemnity",
    title: "Indemnification",
    body: (
      <P>
        You agree to indemnify and hold us harmless from any claims, damages, losses, and expenses
        (including reasonable legal fees) arising out of your use of the Service, your content, or
        your violation of these Terms or of any law or third-party right.
      </P>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    body: (
      <P>
        These Terms are governed by the laws of the State of California, USA, without regard to its
        conflict-of-laws rules, and by applicable U.S. federal law (including the Federal
        Arbitration Act for the section below).
      </P>
    ),
  },
  {
    id: "disputes",
    title: "Dispute resolution; arbitration; class-action waiver",
    body: (
      <>
        <P>
          <B>Please read this section carefully. It affects your legal rights.</B>
        </P>
        <Bullets
          items={[
            <>
              <B>Talk to us first.</B> Most issues can be resolved quickly. Before starting a formal
              proceeding, email us at <A href={`mailto:${CONTACT}`}>{CONTACT}</A> and give us 30
              days to try to resolve it informally.
            </>,
            <>
              <B>Binding individual arbitration.</B> If we can’t resolve a dispute informally, you
              and we agree to resolve it by <B>final and binding individual arbitration</B>, rather
              than in court, except as noted below. Arbitration is less formal than a lawsuit and
              uses a neutral arbitrator instead of a judge or jury.
            </>,
            <>
              <B>Class-action and jury-trial waiver.</B> To the fullest extent permitted by law, you
              and we waive any right to a jury trial and agree that disputes will be brought{" "}
              <B>only in an individual capacity</B>, and <B>not</B> as a plaintiff or class member
              in any class, collective, or representative proceeding.
            </>,
            <>
              <B>30-day opt-out.</B> You can opt out of this arbitration and class-waiver agreement
              by emailing <A href={`mailto:${CONTACT}`}>{CONTACT}</A> within <B>30 days</B> of first
              accepting these Terms, stating that you opt out. Opting out does not affect any other
              part of these Terms.
            </>,
            <>
              <B>Exceptions.</B> Either party may bring a qualifying claim in{" "}
              <B>small-claims court</B>, and either party may seek injunctive relief in court to
              protect intellectual property or stop misuse of the Service. Where arbitration or the
              class waiver is unenforceable, that dispute will be heard in the state or federal
              courts located in California, and you consent to venue and jurisdiction there.
            </>,
          ]}
        />
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to these Terms",
    body: (
      <P>
        We may update these Terms from time to time. When we do, we will revise the “Last updated”
        date above. Material changes will be made reasonably prominent. Continuing to use the
        Service after changes take effect means you accept the updated Terms.
      </P>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <P>
        Questions about these Terms? Email <A href={`mailto:${CONTACT}`}>{CONTACT}</A>. See also our{" "}
        <A href="/privacy">Privacy Policy</A>.
      </P>
    ),
  },
];

export function Terms() {
  return (
    <LegalDoc
      title={<Trans>Terms of Service</Trans>}
      updated="2026-06-23"
      intro={
        <P>
          These Terms of Service (<B>“Terms”</B>) govern your access to and use of Costanio at{" "}
          <B>costan.io</B>. Please read them carefully: they include a limitation of our liability
          and the law that applies. Your use of the Service is also subject to our{" "}
          <A href="/privacy">Privacy Policy</A>.
        </P>
      }
      sections={SECTIONS}
    />
  );
}
