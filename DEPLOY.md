# דפלוי — GitHub, Vercel, Supabase

## 1. GitHub

### אם עדיין אין ריפו

1. ב-[GitHub](https://github.com/new) צור ריפו חדש (למשל `event-registration`), בלי לאתחל עם README.
2. מקומי:

```bash
git remote add origin https://github.com/YOUR_USERNAME/event-registration.git
git branch -M main
git add .
git commit -m "Initial commit"
git push -u origin main
```

### משתני סביבה

אל תעלה `.env.local` — הוא כבר ב-.gitignore. ב-GitHub אפשר להגדיר **Secrets** (Settings → Secrets and variables → Actions) אם תרצה CI שרץ עם משתני סביבה.

---

## 2. Vercel (האפליקציה)

1. היכנס ל-[vercel.com](https://vercel.com) והתחבר עם חשבון GitHub.
2. **Add New Project** → **Import** את הריפו `event-registration`.
3. **Environment Variables** — הוסף:

   | Name              | Value        | Environment   |
   |-------------------|-------------|---------------|
   | `MONDAY_API_TOKEN` | הטוקן מ-Monday.com | Production (ו-Preview אם צריך) |
   | `JWT_SECRET`       | מחרוזת אקראית ארוכה (לחותימת עוגיות) | Production (ו-Preview אם צריך) |

4. **Deploy**. אחרי הבנייה תקבל כתובת כמו `event-registration-xxx.vercel.app`.

### בנייה מקומית (לבדיקה)

```bash
npm run build
npm run start
```

אם יש שגיאות ב-build, תקן לפני דחיפה ל-GitHub (Vercel בונה מהענף שמחובר).

---

## 3. Supabase

האפליקציה כרגע רצה על **Monday.com** (ללא מסד נתונים). Supabase משמש אם תרצה בעתיד:

- מסד נתונים (PostgreSQL)
- Auth
- Storage / Edge Functions

### יצירת פרויקט ב-Supabase

1. [supabase.com](https://supabase.com) → **Start your project**.
2. צור ארגון ופרויקט (בחר אזור קרוב).
3. ב-**Project Settings → API**: שמור את **Project URL** ואת **anon public** key.

### שימוש עתידי

- **מסד נתונים:** התחבר עם ה-connection string מ-Settings → Database.
- **Auth:** החלפת JWT הנוכחי ב-Supabase Auth (דורש שינוי ב-`src/lib/auth.ts` ובמידלוור).
- **Secrets:** אפשר לשמור ערכים ב-Supabase Vault (Edge Functions) אם תריץ לוגיקה שם.

כרגע אין חובה להזין שום דבר מ-Supabase ב-Vercel — האפליקציה עובדת רק עם Monday.com ו-`JWT_SECRET`.

---

## סיכום

| שירות    | שימוש                          |
|----------|---------------------------------|
| **GitHub**  | קוד, גרסאות, חיבור ל-Vercel    |
| **Vercel**  | הוסטינג ל-Next.js + משתני סביבה |
| **Supabase**| אופציונלי — לשלב כשתצטרך DB/Auth |

אחרי דחיפה ל-`main`, Vercel ירוץ build ויעלה גרסה חדשה אוטומטית.
