/* ============================================================
   SESSION & AUTO-LOCK
   ============================================================ */
window.chrome = window.chrome || window.browser;
let sessionKey = null; // the AES key — lives in memory only, never stored
let lockTimer = null;  // tracks the 5 minute countdown

function resetLockTimer() {
  clearTimeout(lockTimer);
  lockTimer = setTimeout(lockSession, 5 * 60 * 1000); // restart the clock
}

function lockSession() {
  sessionKey = null; // wipe the key
  clearTimeout(lockTimer);

  // if the user is in the vault or notes, send them back to dashboard
  const active = document.querySelector(".section.active");
  if (active && (active.id === "vaultSection" || active.id === "notesSection")) {
    showSection("dashboard");
  }
}

window.addEventListener("unload", lockSession); // wipe on popup close
document.addEventListener("click", resetLockTimer);  // any interaction resets the timer
document.addEventListener("keydown", resetLockTimer);


/* ============================================================
   CRYPTO
   ============================================================ */

// derives an AES-GCM key from the master password using PBKDF2
// 600,000 iterations makes brute-forcing the stored data very slow
async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 600000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// encrypts a string — generates a fresh random IV every time
async function encryptWithKey(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // new IV per encryption
  const enc = new TextEncoder();

  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv },
    key,
    enc.encode(plaintext)
  );

  return {
    iv: Array.from(iv),           // stored alongside the ciphertext — needed for decryption
    ciphertext: Array.from(new Uint8Array(cipherBuf)),
  };
}

// decrypts back to a readable string — throws if the key is wrong
async function decryptWithKey(key, encryptedData) {
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(encryptedData.iv) },
    key,
    new Uint8Array(encryptedData.ciphertext)
  );

  return new TextDecoder().decode(plainBuf);
}


/* ============================================================
   UI & NAVIGATION
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

  // all DOM references in one place
  const ui = {
    inputs: {
      lower: document.getElementById("lower"),
      password: document.getElementById("password"),
      vaultWeb: document.getElementById("vaultWebsite"),
      vaultUser: document.getElementById("vaultUser"),
      vaultPass: document.getElementById("vaultPass"),
      length: document.getElementById("length"),
      upper: document.getElementById("upper"),
      nums: document.getElementById("nums"),
      syms: document.getElementById("syms"),
      generatedOutput: document.getElementById("generatedOutput"),
      noteTitle: document.getElementById("noteTitle"),
      noteContent: document.getElementById("noteContent")
    },
    display: {
      result: document.getElementById("result"),
      vaultList: document.getElementById("vaultList"),
      notesList: document.getElementById("notesList"),
      masterMessage: document.getElementById("masterPasswordMessage")
    },
    sections: document.querySelectorAll(".section")
  };

  // hides all sections then shows the target one
  function showSection(id) {
    ui.sections.forEach(function(s) {
      s.classList.remove("active");
    });
    const target = document.getElementById(id);
    if (target) {
      target.classList.add("active");
      window.scrollTo(0, 0);
    }
  }

  // custom confirm modal — looks better than the default browser dialog in an extension
  function askConfirm(text, onYes) {
      const modal = document.getElementById("confirmModal");
      document.getElementById("confirmText").textContent = text;
      modal.style.display = "flex";
      document.getElementById("confirmYes").onclick = function() {
          onYes();
          modal.style.display = "none";
      };
      document.getElementById("confirmNo").onclick = function() {
          modal.style.display = "none";
      };
  }

  // filters vault entries as the user types — just hides/shows DOM elements, doesn't touch storage
  const vaultSearch = document.getElementById("vaultSearch");
  if (vaultSearch) {
    vaultSearch.oninput = function(e) {
      const query = e.target.value.toLowerCase();
      const items = document.querySelectorAll(".vault-item");

      items.forEach(function(item) {
        const website = item.querySelector("strong").textContent.toLowerCase();
        const username = item.querySelector("span").textContent.toLowerCase();

        if (website.includes(query) || username.includes(query)) {
          item.style.display = "block";
        } else {
          item.style.display = "none";
        }
      });
    };
  }

  let nextSection = ""; // remembers where to go after authentication

  document.getElementById("goSecurity").onclick = function() {
    showSection("securitySection");
  };

  document.getElementById("goTools").onclick = function() {
    showSection("toolsSection");
  };

  document.getElementById("backFromSecurity").onclick = function() {
    showSection("dashboard");
  };

  document.getElementById("backFromTools").onclick = function() {
    showSection("dashboard");
  };

  document.getElementById("goChecker").onclick = function() {
    showSection("checkerSection");
  };

  document.getElementById("goGenerator").onclick = function() {
    showSection("generatorSection");
  };

  // vault and notes require a session key — if there isn't one, go to auth first
  document.getElementById("goVault").onclick = function() {
    nextSection = "vaultSection";
    if (sessionKey) {
      showSection("vaultSection");
      loadVault();
    } else {
      showSection("masterPasswordSection");
    }
  };

  document.getElementById("goNotes").onclick = function() {
    nextSection = "notesSection";
    if (sessionKey) {
      showSection("notesSection");
      loadNotes();
    } else {
      showSection("masterPasswordSection");
    }
  };


  /* ============================================================
     MASTER PASSWORD & RESET
     ============================================================ */

  document.getElementById("masterPasswordSubmit").onclick = async function() {
    const input = document.getElementById("masterPasswordInput").value.trim();
    const message = ui.display.masterMessage;

    if (!input) {
      message.textContent = "Please enter a password.";
      return;
    }

    chrome.storage.local.get("masterPassword", async function(data) {
      try {
        if (!data.masterPassword) {
          // first time — generate salt, derive key, store the encrypted marker
          const salt = crypto.getRandomValues(new Uint8Array(16));
          const key = await deriveKey(input, salt);
          const encryptedMarker = await encryptWithKey(key, "masterPassword");

          const toStore = {
            salt: Array.from(salt),
            iv: encryptedMarker.iv,
            ciphertext: encryptedMarker.ciphertext
          };

          chrome.storage.local.set({ masterPassword: toStore }, function() {
            sessionKey = key;
            message.style.color = "green";
            message.textContent = "Master password set!";
            document.getElementById("masterPasswordInput").value = "";
            resetLockTimer();
            showSection(nextSection);
            if (nextSection === "vaultSection") loadVault();
            if (nextSection === "notesSection") loadNotes();
          });

        } else {
          // returning user — re-derive the key and try to decrypt the marker to verify
          const salt = new Uint8Array(data.masterPassword.salt);
          const key = await deriveKey(input, salt);
          const decrypted = await decryptWithKey(key, data.masterPassword);

          if (decrypted === "masterPassword") {
            sessionKey = key;
            message.textContent = "";
            document.getElementById("masterPasswordInput").value = "";
            resetLockTimer();
            showSection(nextSection);
            if (nextSection === "vaultSection") loadVault();
            if (nextSection === "notesSection") loadNotes();
          } else {
            throw new Error("wrong password");
          }
        }
      } catch (e) {
        sessionKey = null; // decryption failed — wrong password
        message.style.color = "#fb7185";
        message.textContent = "Incorrect master password!";
      }
    });
  };

  // two step confirmation because there's no undoing a wipe
  const resetBtn = document.getElementById("resetMasterPassword");
  if(resetBtn) {
    resetBtn.onclick = function() {
        document.getElementById("resetConfirmBox").style.display = "block";
        resetBtn.style.display = "none";
    };
  }

  document.getElementById("confirmResetNo").onclick = function() {
    document.getElementById("resetConfirmBox").style.display = "none";
    document.getElementById("resetMasterPassword").style.display = "block";
  };

  document.getElementById("confirmResetYes").onclick = function() {
    chrome.storage.local.remove(["masterPassword", "vault", "notes"], function() {
      lockSession();
      document.getElementById("resetConfirmBox").style.display = "none";
      document.getElementById("resetMasterPassword").style.display = "block";
      ui.display.masterMessage.style.color = "green";
      ui.display.masterMessage.textContent = "Reset complete.";
    });
  };


  /* ============================================================
     VAULT & NOTES
     ============================================================ */

  async function loadVault() {
    if (!sessionKey) return;

    chrome.storage.local.get("vault", async function(data) {
      const vault = data.vault || [];
      ui.display.vaultList.innerHTML = "";

      for (let i = 0; i < vault.length; i++) {
        const cred = vault[i];

        // decrypt each field — they were encrypted individually on save
        const website = await decryptWithKey(sessionKey, cred.website);
        const username = await decryptWithKey(sessionKey, cred.username);
        const password = await decryptWithKey(sessionKey, cred.password);

        const div = document.createElement("div");
        div.className = "vault-item";
        div.innerHTML = `
          <strong>${website}</strong><span>User: ${username}</span>
          <div class="pass-row"><span class="p-val">Pass: ••••••••</span><button class="t-btn">Show</button></div>
          <button class="d-btn">Delete Credential</button>
        `;

        // toggle between dots and the real password
        const tBtn = div.querySelector(".t-btn");
        let vis = false;
        tBtn.onclick = function() {
          vis = !vis;
          div.querySelector(".p-val").textContent = vis ? "Pass: " + password : "Pass: ••••••••";
          tBtn.textContent = vis ? "Hide" : "Show";
        };

        div.querySelector(".d-btn").onclick = function() {
          askConfirm(`Are you sure you want to delete ${website}?`, function() {
            vault.splice(i, 1);
            chrome.storage.local.set({ vault: vault }, function() {
              loadVault();
            });
          });
        };
        ui.display.vaultList.appendChild(div);
      }
    });
  }

  document.getElementById("saveVault").onclick = async function() {
    if (!sessionKey) return;

    if (!ui.inputs.vaultWeb.value.trim() ||
        !ui.inputs.vaultUser.value.trim() ||
        !ui.inputs.vaultPass.value.trim()) {
      alert("Hold up! You need to fill in all the fields before saving.");
      return;
    }

    // encrypt every field before it touches storage
    const newItem = {
      website: await encryptWithKey(sessionKey, ui.inputs.vaultWeb.value.trim()),
      username: await encryptWithKey(sessionKey, ui.inputs.vaultUser.value.trim()),
      password: await encryptWithKey(sessionKey, ui.inputs.vaultPass.value.trim()),
      savedAt: Date.now()
    };

    chrome.storage.local.get("vault", function(data) {
      const vault = data.vault || [];
      vault.push(newItem);
      chrome.storage.local.set({ vault: vault }, function() {
        loadVault();
        ui.inputs.vaultWeb.value = "";
        ui.inputs.vaultUser.value = "";
        ui.inputs.vaultPass.value = "";
      });
    });
  };

  async function loadNotes() {
    if (!sessionKey) return;

    chrome.storage.local.get("notes", async function(data) {
      const notes = data.notes || [];
      ui.display.notesList.innerHTML = "";

      for (let i = 0; i < notes.length; i++) {
        const title = await decryptWithKey(sessionKey, notes[i].title);
        const content = await decryptWithKey(sessionKey, notes[i].content);

        const div = document.createElement("div");
        div.className = "note-item";

        div.innerHTML = `
          <strong>${title}</strong>
          <div class="n-val">••••••••</div>
          <div class="vault-actions">
            <button class="t-btn n-toggle">Show</button>
            <button class="e-btn">Edit</button>
            <button class="dn-btn">Delete Note</button>
          </div>
        `;

        const tBtn = div.querySelector(".n-toggle");
        let vis = false;
        tBtn.onclick = function() {
          vis = !vis;
          div.querySelector(".n-val").textContent = vis ? content : "••••••••";
          tBtn.textContent = vis ? "Hide" : "Show";
        };

        // repopulates the form so the user can edit and re-save
        div.querySelector(".e-btn").onclick = function() {
          ui.inputs.noteTitle.value = title;
          ui.inputs.noteContent.value = content;
          notes.splice(i, 1); // remove old version
          chrome.storage.local.set({ notes: notes }, function() {
              window.scrollTo(0,0);
          });
        };

        div.querySelector(".dn-btn").onclick = function() {
          askConfirm(`Are you sure you want to delete note "${title}"?`, function() {
            notes.splice(i, 1);
            chrome.storage.local.set({ notes: notes }, function() {
              loadNotes();
            });
          });
        };

        ui.display.notesList.appendChild(div);
      }
    });
  }

  document.getElementById("saveNote").onclick = async function() {
    if (!sessionKey) return;
    const title = ui.inputs.noteTitle.value.trim();
    const content = ui.inputs.noteContent.value.trim();

    if (!title || !content) {
      alert("You can't save a blank note!");
      return;
    }

    const newNote = {
      title: await encryptWithKey(sessionKey, title),
      content: await encryptWithKey(sessionKey, content),
      savedAt: Date.now()
    };

    chrome.storage.local.get("notes", function(data) {
      const notes = data.notes || [];
      notes.push(newNote);
      chrome.storage.local.set({ notes: notes }, function() {
        loadNotes();
        ui.inputs.noteTitle.value = "";
        ui.inputs.noteContent.value = "";
      });
    });
  };


  /* ============================================================
     TOOLS — BREACH CHECKER & GENERATOR
     ============================================================ */

  // SHA-1 hash as uppercase hex — format the HaveIBeenPwned API expects
  async function hashSHA1(str) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(function(b) {
      return b.toString(16).padStart(2, "0");
    }).join("").toUpperCase();
  }

  document.getElementById("check").onclick = async function() {
    const val = ui.inputs.password.value.trim();
    if (!val) return;

    ui.display.result.textContent = "Checking...";
    try {
      const hash = await hashSHA1(val);
      const prefix = hash.substring(0, 5); // only the first 5 chars go to the API — k-anonymity

      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
      const text = await res.text();

      // check if our hash suffix is in the returned list
      const match = text.split(/\r?\n/).find(function(line) {
        return line.startsWith(hash.substring(5));
      });

      if (match) {
        ui.display.result.textContent = "Leaked " + match.split(":")[1] + " times!";
        ui.display.result.style.color = "#fb7185";
      } else {
        ui.display.result.textContent = "Clean!";
        ui.display.result.style.color = "#34d399";
      }
    } catch (e) {
      ui.display.result.textContent = "API Error.";
    }
  };

  document.getElementById("generate").onclick = function() {
    let length = parseInt(ui.inputs.length.value) || 12;
    let chars = "";
    if (ui.inputs.upper.checked) chars += "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (ui.inputs.lower.checked) chars += "abcdefghijklmnopqrstuvwxyz";
    if (ui.inputs.nums.checked) chars += "0123456789";
    if (ui.inputs.syms.checked) chars += "!@#$%^&*()";

    if (!chars) return alert("Pick one!");

    // crypto.getRandomValues instead of Math.random — Math.random isn't cryptographically secure
    let pass = "";
    const rv = crypto.getRandomValues(new Uint32Array(length));
    for (let i = 0; i < length; i++) {
      pass += chars[rv[i] % chars.length];
    }
    ui.inputs.generatedOutput.value = pass;
  };

  document.getElementById("backFromMasterPassword").onclick = function() { showSection("dashboard"); };
  document.getElementById("backFromChecker").onclick = function() { showSection("toolsSection"); };
  document.getElementById("backFromGenerator").onclick = function() { showSection("toolsSection"); };
  document.getElementById("backFromVault").onclick = function() { showSection("securitySection"); };
  document.getElementById("backFromNotes").onclick = function() { showSection("securitySection"); };
});