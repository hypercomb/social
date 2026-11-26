// recipe/recipe-post-style.ts
//
// THE LOOK OF THE PAGE A PHONE POSTS FROM (recipe-post.ts). It is the recipe
// desk's own vocabulary (recipe-style.ts): the page wears `.hc-recipe`, so its
// colours, fields and buttons are the desk's, and this sheet only lays the
// page out as one column that reads on a phone. Fields are a full rem so a
// phone does not zoom into them, and every row wraps rather than scrolls
// sideways. Corners stay on the shape ladder (4px at most).

export const RECIPE_POST_STYLE_ID = 'hc-recipe-post-style'

const RECIPE_POST_STYLE = `
.hc-recipe.hc-recipe-post{position:fixed;inset:0;z-index:var(--hc-recipe-post-z,60002);display:flex;flex-direction:column;overflow:hidden;
  font-family:var(--rp-read);font-size:calc(1rem * var(--hc-panel-scale,1));line-height:1.5;}
.hc-recipe-post .hc-recipe-head{padding:calc(env(safe-area-inset-top,0px) + 0.25em) max(0.5em,env(safe-area-inset-right,0px)) 0.25em max(0.9em,env(safe-area-inset-left,0px));}
.hc-recipe-post .hc-recipe-title{flex:1 1 auto;}
.hc-recipe-post-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}
.hc-recipe-post-column{display:flex;flex-direction:column;gap:1.1em;max-width:40rem;margin:0 auto;
  padding:1.1em max(1rem,env(safe-area-inset-right,0px)) calc(3rem + env(safe-area-inset-bottom,0px)) max(1rem,env(safe-area-inset-left,0px));}
.hc-recipe-post-state{margin:0;font-size:1.05em;color:var(--rp-loud);overflow-wrap:anywhere;}
.hc-recipe-post-quiet{margin:0;font-size:0.9em;color:var(--rp-quiet);overflow-wrap:anywhere;}
.hc-recipe-post-form{display:flex;flex-direction:column;gap:1em;min-width:0;}
.hc-recipe-post-part{display:flex;flex-direction:column;gap:0.35em;min-width:0;margin:0;padding:0;border:0;}
.hc-recipe-post-part > .hc-recipe-label{font-family:var(--rp-read);}
.hc-recipe-post .hc-recipe-field{font-size:1rem;}
.hc-recipe-post textarea.hc-recipe-field{min-height:4.6em;resize:vertical;overflow:auto;}
.hc-recipe-post textarea.hc-recipe-field[data-kind="text"]{min-height:7em;}
.hc-recipe-post-notice{margin:0;padding:0.7em 0.85em;border-radius:var(--rp-card,3px);background:var(--rp-tint);
  font-size:0.92em;color:var(--rp-plain);overflow-wrap:anywhere;}
.hc-recipe-post-measure{margin:0;font-size:0.88em;color:var(--rp-quiet);font-variant-numeric:tabular-nums;overflow-wrap:anywhere;}
.hc-recipe-post-measure.is-over{color:var(--rp-warn);}
.hc-recipe-post-actions{display:flex;flex-wrap:wrap;align-items:center;gap:0.5em;}
.hc-recipe-post-actions .hc-recipe-btn{height:2.6em;font-size:0.95em;}
.hc-recipe-post-said{margin:0;font-size:0.95em;color:var(--rp-plain);overflow-wrap:anywhere;}
.hc-recipe-post-said.is-good{color:var(--rp-good);}
.hc-recipe-post-said.is-bad{color:var(--rp-warn);}
.hc-recipe-post-said:empty{display:none;}
.hc-recipe-post .hc-recipe-catalogue{position:static;inset:auto;z-index:auto;display:block;background:transparent;font-size:1em;}
.hc-recipe-post .hc-recipe-catalogue-head{padding:0.5em 0 0.4em;}
.hc-recipe-post .hc-recipe-catalogue-scroll{overflow:visible;}
.hc-recipe-post .hc-recipe-catalogue-column{padding:1em 0 0;}
.hc-recipe-post > .hc-recipe{z-index:2;}
`

/** Inject the page's one stylesheet into a document, once. */
export function ensureRecipePostStyles(doc: Document): void {
  if (doc.getElementById(RECIPE_POST_STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = RECIPE_POST_STYLE_ID
  style.textContent = RECIPE_POST_STYLE
  ;(doc.head ?? doc.documentElement).appendChild(style)
}
