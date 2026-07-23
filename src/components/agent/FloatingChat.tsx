"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import { useChat } from "./ChatProvider";
import UsageMeter from "@/components/usage/UsageMeter";

// Markdown rendering for agent replies — moved verbatim from the old inline
// AgentChat so replies look identical in the floating panel.
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

export default function FloatingChat() {
  const { messages, open, setOpen, toggleOpen, input, setInput, sending, send } = useChat();
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the newest message in view while the panel is open.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, open]);

  // Focus the input when the panel opens.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // No chat bubble on auth screens.
  if (pathname === "/login" || pathname.startsWith("/auth")) return null;

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {open && (
        <section
          className="fixed bottom-24 right-6 z-50 w-[560px] max-w-[calc(100vw-3rem)] bg-panel border border-line rounded-[18px] p-5 flex flex-col shadow-2xl shadow-black/40"
          aria-label="Cadence assistant"
        >
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="font-grotesk font-semibold text-[15px] tracking-wide text-txt">
                Cadence
              </h2>
              <p className="text-muted text-[12.5px] mt-0.5">Your planning assistant</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-faint hover:text-txt text-[16px] leading-none px-1"
              aria-label="Close chat"
            >
              ×
            </button>
          </div>

          <div
            ref={scrollRef}
            className="flex flex-col gap-2.5 overflow-y-auto max-h-[min(600px,60vh)] pr-1 mb-3"
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className="max-w-[85%] flex flex-col gap-1">
                  <div
                    className={[
                      "rounded-[12px] px-3 py-2 text-[13.5px] leading-relaxed",
                      msg.role === "user" ? "bg-violet/20 text-txt" : "bg-ink text-txt",
                    ].join(" ")}
                  >
                    {msg.role === "user" ? (
                      msg.text
                    ) : (
                      <ReactMarkdown components={markdownComponents}>{msg.text}</ReactMarkdown>
                    )}
                  </div>
                  {msg.noteActions?.map((action, i) => (
                    <div key={i} className="text-faint text-[12px] px-1">
                      {action}
                    </div>
                  ))}
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
              ref={inputRef}
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
      )}

      <button
        onClick={toggleOpen}
        className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-violet text-white text-[20px] shadow-lg shadow-black/40 flex items-center justify-center hover:bg-violet/90 transition-colors"
        aria-label={open ? "Close Cadence chat" : "Open Cadence chat"}
        title="Cadence assistant"
      >
        {open ? "×" : "✦"}
      </button>
    </>
  );
}
