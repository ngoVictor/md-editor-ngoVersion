import { isTauri } from "@tauri-apps/api/core";
export const isDetachedWindow = new URLSearchParams(location.search).get("detached") === "1" && isTauri();
