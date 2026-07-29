import type { ReactNode } from "react";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";

function CodaMotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}

export { CodaMotionProvider };
