import { create } from "zustand";

// In-app replacement for window.prompt/confirm (Next.js dev mode disallows
// them, and native dialogs don't fit the shell anyway). AppDialog renders the
// pending request; these helpers resolve when the user answers.

interface DialogRequest {
  mode: "prompt" | "confirm";
  title: string;
  defaultValue?: string;
  resolve: (value: string | null | boolean) => void;
}

interface DialogStore {
  request: DialogRequest | null;
  setRequest: (request: DialogRequest | null) => void;
}

export const useDialogStore = create<DialogStore>((set) => ({
  request: null,
  setRequest: (request) => set({ request }),
}));

export function askPrompt(title: string, defaultValue = ""): Promise<string | null> {
  return new Promise((resolve) => {
    useDialogStore.getState().setRequest({
      mode: "prompt",
      title,
      defaultValue,
      resolve: resolve as (v: string | null | boolean) => void,
    });
  });
}

export function askConfirm(title: string): Promise<boolean> {
  return new Promise((resolve) => {
    useDialogStore.getState().setRequest({
      mode: "confirm",
      title,
      resolve: resolve as (v: string | null | boolean) => void,
    });
  });
}
