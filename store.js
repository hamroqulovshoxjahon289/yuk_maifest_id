// Fayl asosidagi saqlash: foydalanuvchilar + har bir eganing alohida ma'lumotlari
const fs = require('fs');
const path = require('path');

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file); // atomik almashtirish — fayl yarim yozilib qolmaydi
}

function createStore(dataDir) {
  const usersFile = path.join(dataDir, 'accounts', 'users.json');
  const legacyDir = path.join(dataDir, 'yuk-data');
  const ownersRoot = path.join(legacyDir, 'owners');
  let usersCache = null;

  function users() {
    if (!usersCache) usersCache = readJson(usersFile, []);
    return usersCache;
  }
  function saveUsers() { writeJson(usersFile, users()); }

  function ownerPaths(ownerId) {
    const dir = path.join(ownersRoot, ownerId);
    return {
      dir,
      loads: path.join(dir, 'loads.json'),
      taxonomy: path.join(dir, 'taxonomy.json'),
      zborshiklar: path.join(dir, 'zborshiklar.json'),
      labolar: path.join(dir, 'labolar.json'),
      filiallar: path.join(dir, 'filiallar.json'),
    };
  }

  // Eski (login tizimidan oldingi) ma'lumotlarni birinchi egaga ko'chirish
  const legacyFiles = ['loads', 'taxonomy', 'zborshiklar', 'labolar', 'filiallar'];
  const legacyMarker = path.join(legacyDir, 'MIGRATED.txt');
  function legacyAvailable() {
    return !fs.existsSync(legacyMarker) && fs.existsSync(path.join(legacyDir, 'loads.json'));
  }
  function claimLegacy(ownerId, email) {
    const paths = ownerPaths(ownerId);
    fs.mkdirSync(paths.dir, { recursive: true });
    legacyFiles.forEach((name) => {
      const src = path.join(legacyDir, `${name}.json`);
      if (fs.existsSync(src)) fs.copyFileSync(src, paths[name]); // nusxa olamiz — eski fayl zaxira bo'lib qoladi
    });
    fs.writeFileSync(legacyMarker, `Eski ma'lumotlar ${email} (${ownerId}) akauntiga ko'chirildi: ${new Date().toISOString()}\n`);
  }

  return { users, saveUsers, ownerPaths, readJson, writeJson, legacyAvailable, claimLegacy };
}

module.exports = { createStore, readJson, writeJson };
