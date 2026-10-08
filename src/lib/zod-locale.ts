import { z } from "zod";

// Doğrulama mesajları kullanıcıya gösterildiği için Türkçe olmalı. Yan etkili import: uygulama genelinde bir kez.
z.config(z.locales.tr());
