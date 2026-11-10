import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "KBC Arena | The Ultimate Quiz Challenge", description: "Take the hot seat. Test your knowledge. Climb the prize ladder." };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
