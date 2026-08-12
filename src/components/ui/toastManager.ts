import { Toast as ToastPrimitive } from "@base-ui/react/toast";

export type ToastTone = "good" | "bad";
export type ToastNotifier = (message: string, tone?: ToastTone) => void;

export const toast = ToastPrimitive.createToastManager();

export const notifyToast: ToastNotifier = (message, tone) => {
  toast.add({
    title: message,
    type: tone === "good" ? "success" : tone === "bad" ? "error" : undefined,
    priority: tone === "bad" ? "high" : "low",
  });
};

export const createToastManager = ToastPrimitive.createToastManager;
export const useToastManager = ToastPrimitive.useToastManager;
