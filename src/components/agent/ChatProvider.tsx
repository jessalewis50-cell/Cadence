"use client";

import { createContext, useCallback, useContext, useState } from "react";

// Chat state lives here, mounted in the ROOT layout, so the conversation
// survives navigation between tabs. The send flow (history mapping, error
// copy for upgrade_required / limit_reached, 📝 note-action lines) is the
// logic that previously lived in the inline AgentChat component.

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  noteActions?: string[]; // 📝-prefixed lines from the agent's changes
}

interface ChatContextValue {
  messages: ChatMessage[];
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  input: string;
  setInput: (v: string) => void;
  sending: boolean;
  send: () => Promise<void>;
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "agent",
  text: "Hi, I'm Cadence. Ask me anything about your day.",
};

const ChatContext = createContext<ChatContextValue | null>(null);

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}

export default function ChatProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const toggleOpen = useCallback(() => setOpen((o) => !o), []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", text };
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
        const noteActions = Array.isArray(data.changes)
          ? (data.changes as string[]).filter((c) => c.startsWith("📝"))
          : [];
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "agent",
            text: data.reply ?? "Done.",
            ...(noteActions.length > 0 ? { noteActions } : {}),
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
  }, [input, sending, messages]);

  return (
    <ChatContext.Provider
      value={{ messages, open, setOpen, toggleOpen, input, setInput, sending, send }}
    >
      {children}
    </ChatContext.Provider>
  );
}
