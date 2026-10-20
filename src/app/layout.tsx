import "@fontsource/be-vietnam-pro/400.css";
import "@fontsource/be-vietnam-pro/500.css";
import "@fontsource/be-vietnam-pro/600.css";
import "@fontsource/be-vietnam-pro/700.css";
import "@fontsource/manrope/400.css";
import "@fontsource/manrope/500.css";
import "@fontsource/manrope/600.css";
import "@fontsource/manrope/700.css";
import "@fontsource/manrope/800.css";
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "COSMIC ECHO · Tiếng Vọng Thiên Hà",
  description:
    "Gửi nỗi lòng vào thiên hà, nhận lại sự bình yên. Không gian viết tâm tư và tìm sự đồng hành.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
