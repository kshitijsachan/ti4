import type { ReactNode } from "react";
import Logo from "@/shared/ui/Logo";
import { usePageThemeClass } from "@/hooks/usePageThemeClass";
import classes from "./SiteFrame.module.css";

type Props = {
  actions?: ReactNode;
  children: ReactNode;
};

/** Chrome for the pages around the game: wordmark bar and a centred column. */
export function SiteFrame({ actions, children }: Props) {
  const themeClassName = usePageThemeClass();

  return (
    <div className={`${themeClassName} ${classes.frame}`}>
      <header className={classes.bar}>
        <Logo />
        <div className={classes.spacer} />
        {actions}
      </header>
      <main className={classes.main}>{children}</main>
    </div>
  );
}
