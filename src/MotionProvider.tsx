import { createContext, useContext, useMemo, type ReactNode } from "react";
import { domMax, LazyMotion, MotionConfig } from "motion/react";
import {
  codaMotion as defaultMotion,
  resolveMotionProfile,
  type ResolvedMotionProfile,
} from "./motionProfile";
import { useMotionProfileState } from "./motionProfileStore";

const CodaMotionContext = createContext<ResolvedMotionProfile | null>(null);

function CodaMotionProvider({ children }: { children: ReactNode }) {
  const { profile } = useMotionProfileState();
  const motion = useMemo(() => resolveMotionProfile(profile), [profile]);
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domMax} strict>
        <CodaMotionContext.Provider value={motion}>
          {children}
        </CodaMotionContext.Provider>
      </LazyMotion>
    </MotionConfig>
  );
}

function useCodaMotion() {
  const motion = useContext(CodaMotionContext);
  return motion ?? defaultMotion;
}

export { CodaMotionProvider, useCodaMotion };
