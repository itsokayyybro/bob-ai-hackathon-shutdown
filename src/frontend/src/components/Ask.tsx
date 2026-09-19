import { useState } from 'react';
import { api } from '../lib/api.ts';
import { parseAnswer } from '../lib/format.ts';
import type { AskResponse } from '../lib/types.ts';

const SUGGESTIONS = [
  'What should we deal with first?',
  'Which teams can we still send?',
  'What is blocking our routes?',
  'Why is the bridge uncertain?',
];

export function Ask() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPending(true);
    setError(null);
    try {
      setAnswer(await api.ask(trimmed));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The question could not be answered.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ask">
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label className="visually-hidden" htmlFor="ask-input">
          Ask about the current situation
        </label>
        <input
          id="ask-input"
          className="ask-input"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask in your own words…"
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary" disabled={pending || !question.trim()}>
          {pending ? 'Asking…' : 'Ask'}
        </button>
      </form>

      <div className="ask-suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="pill"
            onClick={() => {
              setQuestion(suggestion);
              void ask(suggestion);
            }}
            disabled={pending}
          >
            {suggestion}
          </button>
        ))}
      </div>

      {error && <p className="error-text">{error}</p>}

      {answer && (
        <div className="ask-answer">
          {parseAnswer(answer.answer).map((block, index) =>
            block.kind === 'heading' ? (
              <p key={index} className="ask-answer-heading">
                {block.content}
              </p>
            ) : block.kind === 'bullet' ? (
              <p key={index} className="ask-answer-bullet">
                {block.content}
              </p>
            ) : (
              <p key={index} className="body-text">
                {block.content}
              </p>
            ),
          )}
          <p className="fine ask-answer-note">
            Answered from the picture as it stands now. Confirm anything critical on the ground.
          </p>
        </div>
      )}
    </div>
  );
}
