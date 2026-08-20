import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

export function RadioShowBackButton({
  onBack,
}: {
  onBack: () => void;
}) {
  return (
    <Button
      variant="text"
      size="compact"
      className="mb-3.5 -ml-1 h-auto gap-1.5 p-1 text-xs text-[#969994] hover:bg-transparent hover:text-foreground"
      onClick={onBack}
    >
      <ArrowLeft size={16} />
      Back
    </Button>
  );
}
