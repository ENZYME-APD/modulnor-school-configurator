import { supabase, signIn, sendMagicLink } from "./cloud/client";

// Supabase Auth (OAuth 2.1 server) sends the user here to approve an AI
// assistant's access. Supabase dashboard: Authentication → OAuth Server →
// Authorization path = /oauth/consent.

const title = document.getElementById("title")!;
const body = document.getElementById("body")!;
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const authorizationId =
  new URLSearchParams(window.location.search).get("authorization_id") ?? "";

function show(heading: string, html: string): void {
  title.textContent = heading;
  body.innerHTML = html;
}

function signInForm(): void {
  show(
    "Sign in to connect",
    `
    <p>Sign in with your Enzyme account to let your assistant use the configurator.</p>
    <form id="f">
      <label>Email<input type="email" name="email" autocomplete="username" required></label>
      <label>Password<input type="password" name="password" autocomplete="current-password"></label>
      <p class="msg" id="msg" role="status"></p>
      <div class="actions">
        <button type="submit">Sign in</button>
        <button type="button" class="secondary" id="magic">Email me a sign-in link</button>
      </div>
    </form>`,
  );
  const form = document.getElementById("f") as HTMLFormElement;
  const msg = document.getElementById("msg")!;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const password = String(fd.get("password") ?? "");
    if (!password) {
      msg.textContent = "Enter your password, or use the sign-in link.";
      return;
    }
    msg.textContent = "Signing in…";
    const err = await signIn(String(fd.get("email")).trim(), password);
    if (err) msg.textContent = err;
    else void run();
  });
  document.getElementById("magic")!.addEventListener("click", async () => {
    const email = String(new FormData(form).get("email") ?? "").trim();
    if (!email) {
      msg.textContent = "Enter your email first.";
      return;
    }
    msg.textContent = "Sending…";
    const err = await sendMagicLink(email);
    msg.textContent =
      err ?? `Check ${email} for a sign-in link; it brings you back here.`;
  });
}

async function run(): Promise<void> {
  if (!authorizationId) {
    show(
      "Nothing to approve",
      "<p>This link is missing its authorization request. Start the connection again from your assistant.</p>",
    );
    return;
  }
  const { data: s } = await supabase.auth.getSession();
  if (!s.session) {
    signInForm();
    return;
  }

  const { data, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    show(
      "Request not found",
      `<p>${esc(error?.message ?? "It may have expired.")} Start the connection again from your assistant.</p>`,
    );
    return;
  }
  if ("redirect_url" in data && !("authorization_id" in data)) {
    window.location.href = data.redirect_url as string; // already approved before
    return;
  }
  const details = data as {
    authorization_id: string;
    client: { name?: string };
    redirect_uri?: string;
  };
  const client = details.client?.name || "This app";
  const back = details.redirect_uri ? new URL(details.redirect_uri).host : "";
  show(
    `Connect ${esc(client)}`,
    `
    <p style="margin-bottom:12px">${esc(client)} wants to use the configurator as <b>${esc(s.session.user.email ?? "")}</b>.</p>
    <ul>
      <li>See the team's cloud projects: layouts, bill of materials, fees and checks.</li>
      <li>Change layouts after asking you first. Every change is logged and can be undone.</li>
    </ul>
    <p class="msg" id="msg" role="status"></p>
    <div class="actions">
      <button id="allow">Allow</button>
      <button class="secondary" id="deny">Cancel</button>
    </div>
    ${back ? `<p class="muted">You’ll be sent back to ${esc(back)}.</p>` : ""}
    <p class="muted">Not you? <a href="#" id="switch" style="color:#74a382">Use another account</a></p>`,
  );

  const decide = async (approve: boolean) => {
    const buttons = body.querySelectorAll("button");
    buttons.forEach((b) => (b.disabled = true));
    const res = approve
      ? await supabase.auth.oauth.approveAuthorization(
          details.authorization_id,
          { skipBrowserRedirect: true },
        )
      : await supabase.auth.oauth.denyAuthorization(details.authorization_id, {
          skipBrowserRedirect: true,
        });
    if (res.error || !res.data?.redirect_url) {
      document.getElementById("msg")!.textContent =
        res.error?.message ?? "Something went wrong. Try again.";
      buttons.forEach((b) => (b.disabled = false));
      return;
    }
    window.location.href = res.data.redirect_url;
  };
  document.getElementById("allow")!.addEventListener("click", () => {
    void decide(true);
  });
  document.getElementById("deny")!.addEventListener("click", () => {
    void decide(false);
  });
  document.getElementById("switch")!.addEventListener("click", async (e) => {
    e.preventDefault();
    await supabase.auth.signOut();
    signInForm();
  });
}

void run();
