import { Link } from 'react-router-dom';

// Public privacy policy and terms pages (linked from the Google sign-in consent screen: Google requires a
// published app to show both). Plain statements of what the app actually stores — keep them in step with db.ts.
function Page({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden py-10 px-6" style={{ background: '#f0ebe1' }}>
      <div className="max-w-2xl mx-auto bg-white rounded-3xl p-8" style={{ boxSizing: 'border-box', border: '3px solid #000', borderBottomWidth: 8 }}>
        <h1 className="text-3xl font-extrabold mb-1" style={{ color: '#94c1c2' }}>{title}</h1>
        <p className="text-xs text-slate-400 mb-6">IrisSpeak · last updated September 10, 2026</p>
        <div className="space-y-4 text-sm text-slate-700 leading-relaxed">{children}</div>
        <Link to="/" className="block mt-8 text-sm font-semibold text-slate-500 hover:text-slate-700">← Back to sign in</Link>
      </div>
    </div>
  );
}
const H = ({ children }: { children: React.ReactNode }) => <h2 className="text-base font-extrabold text-slate-800 pt-2">{children}</h2>;

export function PrivacyScreen() {
  return (
    <Page title="Privacy policy">
      <p>IrisSpeak is a communication aid for children who use picture cards (AAC) and the adults talking with them. This page explains what the app stores and why.</p>
      <H>What we store</H>
      <p><b>Account details.</b> A username, the child's first name and gender, an optional age, notes and communication preferences a parent chooses to add, and the parent's email address. If you sign in with Google we also store the account id and email address Google gives us; we never see your Google password.</p>
      <p><b>Conversations.</b> The questions typed or spoken by the adult, the cards the child chose, the sentences produced from them, and ratings. These are kept so you can revisit previous conversations and so suggestions improve for your child.</p>
      <p><b>Custom words.</b> Words, emoji and photos you add to your child's vocabulary.</p>
      <H>How we use it</H>
      <p>Only to run the app: to sign you in, show your child's cards and history, and personalise suggestions. We do not sell or share personal data with advertisers. Card suggestions on irisspeak.org run on your own device; the server only records what happened in the conversation.</p>
      <H>Where it lives</H>
      <p>Data is stored in a hosted database in the United States. Access is limited to the IrisSpeak team for support and research on de-identified usage.</p>
      <H>Your choices</H>
      <p>You can edit the profile and custom words in the app at any time. To delete an account and everything stored with it, email <a className="underline" href="mailto:coolcottontail@gmail.com">coolcottontail@gmail.com</a> from the address on the account.</p>
      <H>Children</H>
      <p>Accounts are created and controlled by a parent or caregiver. The app is designed for the child to use together with that adult.</p>
    </Page>
  );
}

export function TermsScreen() {
  return (
    <Page title="Terms of service">
      <p>By using IrisSpeak (irisspeak.com, irisspeak.org and the IrisSpeak app) you agree to these terms.</p>
      <H>What IrisSpeak is</H>
      <p>IrisSpeak is a research prototype of a context-aware communication aid. It is offered as-is, without warranty, and may change or be paused at any time. It is not a medical device and does not replace advice from a speech-language pathologist or other professional.</p>
      <H>Your account</H>
      <p>A parent or caregiver creates and is responsible for the account and for what is entered into it. Keep your login code private. You may stop using the service and ask us to delete the account at any time.</p>
      <H>Acceptable use</H>
      <p>Use the app only for communicating with the child it was set up for. Do not attempt to access other families' data or to disrupt the service.</p>
      <H>Content</H>
      <p>Words, photos and notes you add remain yours. You give us permission to store and display them inside the app for your account.</p>
      <H>Contact</H>
      <p>Questions about these terms: <a className="underline" href="mailto:coolcottontail@gmail.com">coolcottontail@gmail.com</a>.</p>
    </Page>
  );
}
