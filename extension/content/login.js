const Cc = Components.classes;
const Ci = Components.interfaces;
const Cr = Components.results;
const Cu = Components.utils;

let feed = window.arguments[0].wrappedJSObject;
let authInfo = window.arguments[1].QueryInterface(Ci.nsIAuthInformation);
let result = window.arguments[2].wrappedJSObject;

function doOnLoad() {
  stringBundle = document.getElementById("snowlStringBundle");

  let prompt;
  let feedURL = (feed.humanURI || feed.machineURI).spec;
  if (feed.name)
    prompt = stringBundle.getFormattedString("namedFeedPrompt", [feed.name, feedURL]);
  else
    prompt = stringBundle.getFormattedString("namelessFeedPrompt", [feedURL]);
  document.getElementById("prompt").appendChild(document.createTextNode(prompt));

  document.getElementById("realm").value = authInfo.realm;

  document.getElementById("username").value = authInfo.username;
  document.getElementById("password").value = authInfo.password;

  // FIXME: handle authInfo.flags (i.e. don't prompt for username if it's
  // already available, and prompt for domain if necessary).
}

function doShowPassword() {
  if (document.getElementById("showPassword").checked)
    document.getElementById("password").removeAttribute("type");
  else
    document.getElementById("password").setAttribute("type", "password");
}

function doOK() {
  // FIXME: validate input.
  result.proceed = true;
  result.remember = document.getElementById("rememberPassword").checked;
  authInfo.username = document.getElementById("username").value;
  authInfo.password = document.getElementById("password").value;
  return true;
}

function doCancel() {
  result.proceed = false;
  return true;
}
