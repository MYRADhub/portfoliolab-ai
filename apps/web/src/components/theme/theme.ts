export const THEME_KEY = "pl-theme";

/**
 * Runs before the page paints so there is no flash of the wrong theme. The stored choice wins; with none stored the
 * operating system's preference is used. Kept as a string because it is inlined into the document head.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("${THEME_KEY}");var d=t?t==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;if(d)document.documentElement.classList.add("dark")}catch(e){}})()`;
