// Small dropdown menu for toolbar buttons (Open ▾, Save as ▾).

export interface MenuItem {
  label: string;
  hint?: string;
  run: () => void;
}

let openMenu: HTMLDivElement | null = null;

function close(): void {
  openMenu?.remove();
  openMenu = null;
  document
    .querySelectorAll(".tb-btn[aria-expanded=true]")
    .forEach((b) => b.setAttribute("aria-expanded", "false"));
}

/** Opens a menu under `anchor` with the given items. */
export function showMenu(anchor: HTMLElement, items: MenuItem[]): void {
  const wasOpen = anchor.getAttribute("aria-expanded") === "true";
  close();
  if (wasOpen) return;

  const menu = document.createElement("div");
  menu.className = "tb-menu";
  menu.setAttribute("role", "menu");
  items.forEach((item) => {
    const b = document.createElement("button");
    b.setAttribute("role", "menuitem");
    b.innerHTML = `<span>${item.label}</span>${item.hint ? `<small>${item.hint}</small>` : ""}`;
    b.addEventListener("click", () => {
      close();
      item.run();
    });
    menu.appendChild(b);
  });
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = `${Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${r.bottom + 4}px`;
  anchor.setAttribute("aria-expanded", "true");
  openMenu = menu;
  (menu.querySelector("button") as HTMLButtonElement | null)?.focus();
}

/** Attaches a dropdown to a button. Items are built when it opens. */
export function attachMenu(button: HTMLElement, items: () => MenuItem[]): void {
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    showMenu(button, items());
  });
}

document.addEventListener("click", (e) => {
  if (openMenu && !openMenu.contains(e.target as Node)) close();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") close();
});
window.addEventListener("resize", close);
