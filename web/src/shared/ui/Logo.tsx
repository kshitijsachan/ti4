import { Link } from "react-router-dom";
import classes from "./Logo.module.css";

/** Wordmark. Links home, which resolves to the player's games when signed in. */
function Logo() {
  return (
    <Link to="/" className={classes.logo} aria-label="TI4 Online home">
      <span className={classes.mark}>TI4</span>
      <span className={classes.word}>Online</span>
    </Link>
  );
}

export default Logo;
