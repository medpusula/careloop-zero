# CareLoop Zero — Prototip

Bakım verenler için klinisyen talimatlarından takip görevi çıkaran, görev takip
prototipi. Sadece sentetik veriyle geliştirilmektedir; gerçek hasta/kimlik verisi
girilmemelidir.

## Kurulum (Windows PowerShell)

```
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

`.env` dosyasını açıp `AI_API_KEY` alanına kendi anahtarınızı yazın. Anahtar
Anthropic ise `AI_PROVIDER=anthropic`, OpenAI ise `AI_PROVIDER=openai`, Groq ise
`AI_PROVIDER=groq` olarak ayarlayın (şu an Groq ile, `openai/gpt-oss-120b`
modeliyle test edildi ve çalışıyor). Bu dosya `.gitignore`'da olduğu için
depoya girmez.

## Çalıştırma

```
python seed_data.py
python app.py
```

Tarayıcıda http://127.0.0.1:5000 adresini açın.

## Bilinen sınırlamalar (MVP aşaması)

- Kullanıcı hesabı/girişi yok — tek kullanıcılı, yerel SQLite veritabanı.
- AI taslağı JSON parse edemezse ham çıktıyı gösterir, otomatik tekrar denemez.
- Aynı talimattan tekrar taslak oluşturmak, aynı görevleri tekrar önerip
  mükerrer görev oluşturabilir — kullanıcı onay adımında bunu fark etmelidir.
- Erişim engeli takibi (ulaşım, randevu kişisi bulma vb.) henüz yok —
  kullanıcı araştırmasıyla doğrulanmadan eklenmeyecek.
