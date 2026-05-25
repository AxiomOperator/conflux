export function formatDateTime(value?: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDate(value?: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
  }).format(date);
}

export function formatRelativeTime(value?: string | null) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return "—";
  }

  const diffMs = date.valueOf() - Date.now();
  const absDiffMs = Math.abs(diffMs);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (absDiffMs < 60_000) {
    return "just now";
  }
  if (absDiffMs < 3_600_000) {
    return rtf.format(Math.round(diffMs / 60_000), "minute");
  }
  if (absDiffMs < 86_400_000) {
    return rtf.format(Math.round(diffMs / 3_600_000), "hour");
  }
  if (absDiffMs < 604_800_000) {
    return rtf.format(Math.round(diffMs / 86_400_000), "day");
  }

  return rtf.format(Math.round(diffMs / 604_800_000), "week");
}

export function formatDuration(start?: string | null, end?: string | null) {
  if (!start || !end) {
    return "—";
  }

  const durationMs = new Date(end).valueOf() - new Date(start).valueOf();
  if (Number.isNaN(durationMs) || durationMs <= 0) {
    return "—";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function shortId(value: string, length = 8) {
  if (value.length <= length) {
    return value;
  }

  return `${value.slice(0, length)}…`;
}

export function truncate(value: string, maxLength = 80) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}
