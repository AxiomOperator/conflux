"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "Knowledge",
    emojis: [
      "📚",
      "📖",
      "📝",
      "📄",
      "📃",
      "📜",
      "📋",
      "🗒️",
      "🗂️",
      "📁",
      "📂",
      "🗃️",
    ],
  },
  {
    label: "Work",
    emojis: [
      "💼",
      "🏢",
      "⚙️",
      "🔧",
      "🛠️",
      "🔩",
      "💡",
      "🎯",
      "📊",
      "📈",
      "📉",
      "🗓️",
    ],
  },
  {
    label: "Tech",
    emojis: [
      "💻",
      "🖥️",
      "🖱️",
      "⌨️",
      "📱",
      "🤖",
      "🧠",
      "🔬",
      "🧪",
      "🔭",
      "🛰️",
      "⚡",
    ],
  },
  {
    label: "People",
    emojis: [
      "👥",
      "👤",
      "🧑‍💼",
      "👩‍💻",
      "🧑‍🔬",
      "🧑‍🏫",
      "🤝",
      "💬",
      "📣",
      "🗣️",
      "🎓",
      "🏆",
    ],
  },
  {
    label: "Nature",
    emojis: [
      "🌍",
      "🌿",
      "🌱",
      "🔥",
      "💧",
      "⭐",
      "🌟",
      "✨",
      "🎆",
      "🌈",
      "🌸",
      "🍀",
    ],
  },
  {
    label: "Misc",
    emojis: [
      "🏠",
      "🚀",
      "🎉",
      "🎨",
      "🎵",
      "🎮",
      "🏋️",
      "🔐",
      "🔑",
      "🗺️",
      "📌",
      "🚩",
    ],
  },
];

const ALL_EMOJIS = EMOJI_GROUPS.flatMap((g) => g.emojis);

interface EmojiIconPickerProps {
  value: string;
  onChange: (emoji: string) => void;
}

export function EmojiIconPicker({ value, onChange }: EmojiIconPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = search.trim()
    ? ALL_EMOJIS.filter((e) => e.includes(search.trim()))
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-9 w-full justify-start gap-2 font-normal"
          aria-label="Pick an icon"
        >
          <span className="text-lg leading-none">{value || "📚"}</span>
          <span className="text-muted-foreground">Choose icon</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start">
        <Input
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-3 h-8"
        />
        {filtered ? (
          filtered.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No match
            </p>
          ) : (
            <div className="grid grid-cols-8 gap-0.5">
              {filtered.map((emoji) => (
                <EmojiButton
                  key={emoji}
                  emoji={emoji}
                  selected={emoji === value}
                  onSelect={() => {
                    onChange(emoji);
                    setOpen(false);
                    setSearch("");
                  }}
                />
              ))}
            </div>
          )
        ) : (
          <div className="max-h-56 space-y-2 overflow-y-auto">
            {EMOJI_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {group.label}
                </p>
                <div className="grid grid-cols-8 gap-0.5">
                  {group.emojis.map((emoji) => (
                    <EmojiButton
                      key={emoji}
                      emoji={emoji}
                      selected={emoji === value}
                      onSelect={() => {
                        onChange(emoji);
                        setOpen(false);
                        setSearch("");
                      }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function EmojiButton({
  emoji,
  selected,
  onSelect,
}: {
  emoji: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex h-8 w-8 items-center justify-center rounded text-lg transition-colors hover:bg-accent ${selected ? "bg-accent ring-2 ring-ring" : ""}`}
      title={emoji}
    >
      {emoji}
    </button>
  );
}
