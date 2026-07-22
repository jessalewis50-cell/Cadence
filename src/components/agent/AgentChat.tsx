"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import UsageMeter from "@/components/usage/UsageMeter";

interface Message {
  id: string;
  role: "user" | "agent";
  text: string;
}

// Render the agent's Markdown to match the chat card: app fonts, text-txt/muted
// colors, comfortable spacing, and scannable lists.
const markdownComponents: Components = {
  p:  ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-txt">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-4 my-1.5 space-y-0.5 marker:text-faint">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 my-1.5 space-y-0.5 marker:text-faint">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a:  ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-violet underline underline-offset-2">
      {children}
    </a>
  ),
  h1: ({ children }) => <h4 className="font-grotesk font-semibold text-txt text-[14px] mt-2 first:mt-0 mb-1">{children}</h4>,
  h2: ({ children }) => <h4 className="font-grotesk font-semibold text-txt text-[14px] mt-2 first:mt-0 mb-1">{children}</h4>,
  h3: ({ children }) => <h4 className="font-grotesk font-semibold text-txt text-[13.5px] mt-2 first:mt-0 mb-1">{children}</h4>,
  code: ({ children }) => <code className="bg-panel-2 rounded px-1 py-0.5 text-[12px]">{children}</code>,
  pre: ({ children }) => (
    <pre className="bg-panel-2 rounded-lg p-2 my-2 overflow-x-auto text-[12px] [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => <blockquote className="border-l-2 border-line pl-2 text-muted my-2">{children}</blockquote>,
  hr: () => <hr className="border-line my-2" />,
};

export default function AgentChat() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "agent",
      text: "Hi, I'm Cadence. Ask me anything about your day.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = { id: crypto.randomUUID(), role: "user", text };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history.map((m) => ({
            role: m.role === "agent" ? "assistant" : "user",
            content: m.text,
          })),
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const errText =
          data?.code === "upgrade_required"
            ? "The AI assistant is part of Cadence Pro. Your account is on the free plan — upgrading unlocks agent chat and AI scheduling. (Pricing coming soon.)"
            : data?.code === "limit_reached"
              ? data.error // server copy is already user-facing
              : (data && typeof data.error === "string" && data.error) ||
                "Something went wrong. Please try again.";
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "agent", text: errText },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "agent",
            text: data.reply ?? "Done.",
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "agent",
          text: "Couldn't reach the assistant. Check your connection and try again.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <section className="bg-panel border border-line rounded-[18px] p-5 flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="font-grotesk font-semibold text-[15px] tracking-wide text-txt">
            Cadence
          </h2>
          <p className="text-muted text-[12.5px] mt-0.5">Your planning assistant</p>
        </div>
        <span className="text-violet text-[18px] flex-shrink-0">✦</span>
      </div>

      <div
        ref={scrollRef}
        className="flex flex-col gap-2.5 overflow-y-auto max-h-[280px] pr-1 mb-3"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={[
                "max-w-[85%] rounded-[12px] px-3 py-2 text-[13.5px] leading-relaxed",
                msg.role === "user" ? "bg-violet/20 text-txt" : "bg-ink text-txt",
              ].join(" ")}
            >
              {msg.role === "user" ? (
                msg.text
              ) : (
                <ReactMarkdown components={markdownComponents}>{msg.text}</ReactMarkdown>
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-[12px] px-3 py-2 text-[13.5px] bg-ink text-faint">
              Thinking…
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 mt-auto">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={sending}
          placeholder="Message Cadence…"
          className="flex-1 bg-ink border border-line rounded-lg px-3 py-1.5 text-txt text-sm placeholder:text-faint outline-none focus:border-violet transition-colors disabled:opacity-60"
        />
        <button
          onClick={send}
          disabled={!input.trim() || sending}
          className="bg-violet text-white font-medium text-sm rounded-lg px-4 py-1.5 transition-colors hover:bg-violet/90 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
      <UsageMeter />
    </section>
  );
}
