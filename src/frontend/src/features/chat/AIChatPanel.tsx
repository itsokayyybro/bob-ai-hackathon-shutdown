import { useCallback, useEffect, useRef, useState } from 'react'
import { dashboardApi, getErrorMessage, isAbortError } from '../../api'

export interface ChatPrompt {
  id: number
  question: string
}

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  status: 'sent' | 'pending' | 'error'
  question?: string
}

interface AIChatPanelProps {
  pendingPrompt: ChatPrompt | null
  onPromptConsumed: (id: number) => void
}

const welcomeMessage: ChatMessage = {
  id: 0,
  role: 'assistant',
  status: 'sent',
  text: 'Ask about the current emergency situation, priorities, evidence conflicts, or response routes.',
}

export function AIChatPanel({ pendingPrompt, onPromptConsumed }: AIChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage])
  const [input, setInput] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const nextMessageIdRef = useRef(1)
  const submittingRef = useRef(false)
  const requestControllerRef = useRef<AbortController | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const runRequest = useCallback((question: string, answerId: number) => {
    const controller = new AbortController()
    requestControllerRef.current = controller

    void dashboardApi.askQuestion(question, controller.signal)
      .then(response => {
        const answer = typeof response.answer === 'string' && response.answer.trim()
          ? response.answer.trim()
          : 'The AI service returned no answer.'
        setMessages(current => current.map(message => (
          message.id === answerId
            ? { ...message, text: answer, status: 'sent' }
            : message
        )))
      })
      .catch(error => {
        if (isAbortError(error)) return
        setMessages(current => current.map(message => (
          message.id === answerId
            ? {
                ...message,
                text: `Unable to answer: ${getErrorMessage(error)}`,
                status: 'error',
              }
            : message
        )))
      })
      .finally(() => {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null
          submittingRef.current = false
          setIsSubmitting(false)
        }
      })
  }, [])

  const startQuestion = useCallback((rawQuestion: string): boolean => {
    const question = rawQuestion.trim()
    if (!question || submittingRef.current) return false

    submittingRef.current = true
    setIsSubmitting(true)
    const userId = nextMessageIdRef.current++
    const answerId = nextMessageIdRef.current++
    setMessages(current => [
      ...current,
      { id: userId, role: 'user', text: question, status: 'sent' },
      {
        id: answerId,
        role: 'assistant',
        text: 'Analyzing the latest operational data…',
        status: 'pending',
        question,
      },
    ])
    runRequest(question, answerId)
    return true
  }, [runRequest])

  const retryMessage = useCallback((message: ChatMessage) => {
    if (!message.question || submittingRef.current) return
    submittingRef.current = true
    setIsSubmitting(true)
    setMessages(current => current.map(item => (
      item.id === message.id
        ? { ...item, text: 'Retrying request…', status: 'pending' }
        : item
    )))
    runRequest(message.question, message.id)
  }, [runRequest])

  useEffect(() => {
    if (!pendingPrompt || isSubmitting) return
    if (startQuestion(pendingPrompt.question)) {
      onPromptConsumed(pendingPrompt.id)
      window.requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isSubmitting, onPromptConsumed, pendingPrompt, startQuestion])

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    bottomRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [messages])

  useEffect(() => () => requestControllerRef.current?.abort(), [])

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (startQuestion(input)) setInput('')
  }

  return (
    <section className="feature-panel chat-panel" aria-labelledby="chat-heading">
      <div className="panel-heading-row">
        <div>
          <p className="panel-eyebrow">Decision support</p>
          <h2 id="chat-heading">AI operations assistant</h2>
        </div>
        <span className={`state-chip ${isSubmitting ? 'is-refreshing' : 'is-connected'}`}>
          {isSubmitting ? 'Responding' : 'Ready'}
        </span>
      </div>

      <div
        className="chat-log"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Conversation with the AI operations assistant"
      >
        {messages.map(message => (
          <article
            key={message.id}
            className={`chat-message ${message.role} is-${message.status}`}
            aria-label={`${message.role === 'user' ? 'You' : 'AI assistant'}: ${message.status}`}
          >
            <p>{message.text}</p>
            {message.status === 'error' && (
              <button
                type="button"
                className="text-button"
                onClick={() => retryMessage(message)}
                disabled={isSubmitting}
              >
                Retry this question
              </button>
            )}
          </article>
        ))}
        <div ref={bottomRef} aria-hidden="true" />
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <label htmlFor="ai-question">Ask about the current operation</label>
        <div className="chat-input-row">
          <input
            ref={inputRef}
            id="ai-question"
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder="Why is the top priority urgent?"
            autoComplete="off"
            maxLength={500}
            aria-describedby="ai-question-help"
          />
          <button
            type="submit"
            className="button button-primary"
            disabled={isSubmitting || !input.trim()}
          >
            Send
          </button>
        </div>
        <p id="ai-question-help" className="field-help">
          {isSubmitting ? 'Wait for the current response before sending another question.' : 'Press Enter to send.'}
        </p>
      </form>
    </section>
  )
}
