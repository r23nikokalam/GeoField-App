# GeoField

دفترچه صحرایی زمین‌شناسی آفلاین برای Android.

## قابلیت‌ها
- ثبت هفت فیلد مشاهده به ترتیب فرم
- ذخیره محلی و آفلاین
- ویرایش و حذف رکورد
- خروجی Excel واقعی با فرمت XLSX
- پشتیبان‌گیری و بازیابی JSON

## ساخت
نیازمند Node.js 20 و Java 21:
```bash
npm install
npm run build
npx cap add android
npx cap sync android
cd android
./gradlew assembleDebug
```

Workflow گیت‌هاب نیز با هر push به شاخه main/master یا اجرای دستی، APK آزمایشی را می‌سازد.
