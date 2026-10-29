import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useCreateContactMessage } from '@workspace/api-client-react';
import { ArrowRightIcon, Icon, TickIcon } from '../icons';
import { CONTACT_RETENTION_DAYS, CONTACT_TOPICS, LEGAL_LOCATION, LEGAL_OPERATOR, type LegalTopic } from '../legal';
import { anchor, Footer, Navbar, PRIVACY_PATH, SECURITY_PATH, track, usePageMeta } from '../site';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MESSAGE_MIN = 10;
const MESSAGE_MAX = 5000;

/** What helps us answer each kind of message, said under the topic picker. */
const TOPIC_HINTS: Record<LegalTopic, string> = {
  general: 'Ask anything: how the check reads a statement of work, whether it fits how your agency works.',
  pilot: 'Tell us about your agency and the client project you would run it on first.',
  privacy:
    'Say which GitHub account or email address the request is about. We may ask you to confirm it from that account before we act.',
  security:
    'Say what you found, how to reproduce it and what it could expose. Please don’t include live passwords or keys.',
  grievance: 'We acknowledge a complaint within 3 business days and aim to resolve it within 30 days.',
  legal: 'Name the section of the terms or policy your question is about, if there is one.',
};

type Fields = 'name' | 'email' | 'message';

/** Turns a failed send into one sentence the visitor can act on. */
function sendErrorMessage(status: number | undefined): string {
  if (status === 429) return 'Too many messages from your network. Wait a few minutes, then try again.';
  if (status === undefined) return "We couldn't reach ScopeCI. Check your connection and try again.";
  return 'Something went wrong on our side. Your message wasn’t sent; try again in a minute.';
}

function initialTopic(): LegalTopic {
  const asked = new URLSearchParams(window.location.search).get('topic');
  return CONTACT_TOPICS.some((topic) => topic.value === asked) ? (asked as LegalTopic) : 'general';
}

export default function Contact() {
  usePageMeta(
    'Contact — ScopeCI',
    'Write to the person who runs ScopeCI: questions about the pilot, your data, a security problem or a complaint.',
  );

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [topic, setTopic] = useState<LegalTopic>(initialTopic);
  const [message, setMessage] = useState('');
  // Hidden from people (see .hp-field); a value means a bot filled every input.
  const [trap, setTrap] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Fields, string>>>({});
  // Counts rejected submits, so the same message twice is still announced.
  const [attempt, setAttempt] = useState(0);
  const [formError, setFormError] = useState('');
  const [sentTo, setSentTo] = useState('');

  const send = useCreateContactMessage();
  const sending = send.isPending;
  const refs = {
    name: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    message: useRef<HTMLTextAreaElement>(null),
  };
  const formErrorRef = useRef<HTMLParagraphElement>(null);

  // After a rejected submit, focus the first field that needs fixing, so its
  // label and error are read out. It runs after the re-render that shows them.
  useEffect(() => {
    if (attempt === 0) return;
    const first = (['name', 'email', 'message'] as const).find((field) => errors[field]);
    if (first) refs[first].current?.focus();
    else if (formError) formErrorRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (sending) return;

    const found: Partial<Record<Fields, string>> = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedMessage = message.trim();
    if (!trimmedName) found.name = 'Enter your name.';
    if (!trimmedEmail) found.email = 'Enter your email address, so we can reply.';
    else if (trimmedEmail.length > 254 || !EMAIL_PATTERN.test(trimmedEmail)) found.email = "That doesn't look like an email address.";
    if (!trimmedMessage) found.message = 'Write your message.';
    else if (trimmedMessage.length < MESSAGE_MIN) found.message = `Say a little more: at least ${MESSAGE_MIN} characters.`;

    setErrors(found);
    setFormError('');
    if (Object.keys(found).length > 0) {
      setAttempt((count) => count + 1);
      return;
    }

    track('contact_submitted');
    send.mutate(
      {
        data: {
          name: trimmedName.slice(0, 120),
          email: trimmedEmail.toLowerCase(),
          company: company.trim() ? company.trim().slice(0, 200) : undefined,
          topic,
          message: trimmedMessage.slice(0, MESSAGE_MAX),
          website: trap || undefined,
        },
      },
      {
        onSuccess: () => {
          setSentTo(trimmedEmail.toLowerCase());
          track('contact_sent');
        },
        onError: (error) => {
          const status = error?.status;
          setFormError(status === 400 ? (error?.data?.error ?? 'Check the form and try again.') : sendErrorMessage(status));
          setAttempt((count) => count + 1);
          track('contact_error');
        },
      },
    );
  };

  const reset = () => {
    setMessage('');
    setSentTo('');
    send.reset();
  };

  const fieldProps = (field: Fields) => ({
    className: errors[field] ? 'is-invalid' : undefined,
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `contact-${field}-error` : undefined,
  });
  const fieldError = (field: Fields) =>
    errors[field] ? (
      <p className="field-error" id={`contact-${field}-error`} role="alert" key={`${field}-${attempt}`}>
        {errors[field]}
      </p>
    ) : null;

  return (
    <div className="site site-legal">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Navbar />
      <main id="main">
        <section className="contact" aria-labelledby="contact-title">
          <div className="container">
            <header className="contact-head">
              <p className="kicker">
                <span className="kicker-num">@</span>
                <span className="kicker-rule" aria-hidden="true" />
                Contact
              </p>
              <h1 className="contact-title display" id="contact-title">
                Write to a person.
              </h1>
              <p className="contact-lede">
                ScopeCI is run by {LEGAL_OPERATOR} in Mumbai. There is no support queue and no chatbot: every message is
                read and answered by a person.
              </p>
            </header>

            <div className="contact-grid">
              <div className="contact-card">
                {sentTo ? (
                  <div className="settled" role="status" data-testid="contact-sent">
                    <span className="settled-mark">
                      <Icon icon={TickIcon} size={22} />
                    </span>
                    <h2>Message sent.</h2>
                    <p>
                      We’ll reply to <strong>{sentTo}</strong>. If it’s about your data or a complaint, we’ll confirm we
                      have it first.
                    </p>
                    <button type="button" className="button button-secondary" onClick={reset}>
                      Send another message
                    </button>
                  </div>
                ) : (
                  <form className="contact-form" onSubmit={submit} noValidate>
                    <div className="contact-row">
                      <div className="field">
                        <label htmlFor="contact-name">Your name</label>
                        <input
                          id="contact-name"
                          ref={refs.name}
                          name="name"
                          type="text"
                          autoComplete="name"
                          maxLength={120}
                          value={name}
                          disabled={sending}
                          onChange={(event) => {
                            setName(event.target.value);
                            if (errors.name) setErrors({ ...errors, name: undefined });
                          }}
                          data-testid="input-contact-name"
                          {...fieldProps('name')}
                        />
                        {fieldError('name')}
                      </div>
                      <div className="field">
                        <label htmlFor="contact-email">Email</label>
                        <input
                          id="contact-email"
                          ref={refs.email}
                          name="email"
                          type="email"
                          inputMode="email"
                          autoComplete="email"
                          maxLength={254}
                          placeholder="you@agency.com"
                          value={email}
                          disabled={sending}
                          onChange={(event) => {
                            setEmail(event.target.value);
                            if (errors.email) setErrors({ ...errors, email: undefined });
                          }}
                          data-testid="input-contact-email"
                          {...fieldProps('email')}
                        />
                        {fieldError('email')}
                      </div>
                    </div>

                    <div className="field">
                      <label htmlFor="contact-company">
                        Agency or company <span className="field-optional">optional</span>
                      </label>
                      <input
                        id="contact-company"
                        name="company"
                        type="text"
                        autoComplete="organization"
                        maxLength={200}
                        value={company}
                        disabled={sending}
                        onChange={(event) => setCompany(event.target.value)}
                      />
                    </div>

                    <div className="field">
                      <label htmlFor="contact-topic">What it’s about</label>
                      <select
                        id="contact-topic"
                        name="topic"
                        value={topic}
                        disabled={sending}
                        onChange={(event) => setTopic(event.target.value as LegalTopic)}
                        aria-describedby="contact-topic-hint"
                        data-testid="select-contact-topic"
                      >
                        {CONTACT_TOPICS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <p className="field-hint" id="contact-topic-hint">
                        {TOPIC_HINTS[topic]}
                      </p>
                    </div>

                    <div className="field">
                      <div className="field-label-row">
                        <label htmlFor="contact-message">Message</label>
                        <span className="field-count mono" aria-hidden="true">
                          {message.trim().length.toLocaleString('en-US')} / {MESSAGE_MAX.toLocaleString('en-US')}
                        </span>
                      </div>
                      <textarea
                        id="contact-message"
                        ref={refs.message}
                        name="message"
                        className={`textarea${errors.message ? ' is-invalid' : ''}`}
                        rows={7}
                        maxLength={MESSAGE_MAX}
                        value={message}
                        disabled={sending}
                        onChange={(event) => {
                          setMessage(event.target.value);
                          if (errors.message) setErrors({ ...errors, message: undefined });
                        }}
                        aria-invalid={Boolean(errors.message)}
                        aria-describedby={errors.message ? 'contact-message-error' : undefined}
                        data-testid="input-contact-message"
                      />
                      {fieldError('message')}
                    </div>

                    <div className="hp-field" aria-hidden="true">
                      <label htmlFor="contact-website">Website</label>
                      <input
                        id="contact-website"
                        name="website"
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        value={trap}
                        onChange={(event) => setTrap(event.target.value)}
                      />
                    </div>

                    {formError && (
                      <p className="form-error" role="alert" tabIndex={-1} ref={formErrorRef} key={`form-${attempt}`}>
                        {formError}
                      </p>
                    )}

                    <div className="contact-submit">
                      <button
                        type="submit"
                        className="button button-primary button-lg"
                        disabled={sending}
                        data-testid="button-contact-send"
                      >
                        {sending ? 'Sending…' : 'Send message'}
                        {!sending && <Icon icon={ArrowRightIcon} size={16} />}
                      </button>
                      <p className="contact-fineprint">
                        We keep your message for {CONTACT_RETENTION_DAYS} days to reply and keep a record. See the{' '}
                        <a className="text-link" href={PRIVACY_PATH}>
                          Privacy Policy
                        </a>
                        .
                      </p>
                    </div>
                  </form>
                )}
              </div>

              <aside className="contact-notes" aria-label="Before you write">
                <dl>
                  <div>
                    <dt>Questions about the product</dt>
                    <dd>
                      Most are answered in the{' '}
                      <a className="text-link" href={anchor('questions')}>
                        questions on the home page
                      </a>
                      : what the check reads, what it costs, which tools it works with.
                    </dd>
                  </div>
                  <div>
                    <dt>Your data</dt>
                    <dd>
                      To see, correct or delete what ScopeCI holds about you, choose “My data”. We reply within 30 days.
                    </dd>
                  </div>
                  <div>
                    <dt>A security problem</dt>
                    <dd>
                      Choose “A security problem”.{' '}
                      <a className="text-link" href={`${SECURITY_PATH}#reporting`}>
                        Security
                      </a>{' '}
                      says what to include, and how we treat research done in good faith.
                    </dd>
                  </div>
                  <div>
                    <dt>Who you are writing to</dt>
                    <dd>
                      {LEGAL_OPERATOR}, {LEGAL_LOCATION}. Also ScopeCI’s Grievance Officer.
                    </dd>
                  </div>
                </dl>
              </aside>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
