"use client";

import { useState } from "react";

export function useViewAsUser() {
  const [loading, setLoading] = useState(false);

  async function toggle(method: "POST" | "DELETE") {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/view-as-user", { method });
      if (!response.ok) {
        throw new Error(`View-as-user toggle failed: ${response.status}`);
      }
      window.location.reload();
    } finally {
      setLoading(false);
    }
  }

  return {
    disable: () => toggle("DELETE"),
    enable: () => toggle("POST"),
    loading,
  };
}
