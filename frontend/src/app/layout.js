import "./globals.css";

export const metadata = {
  title: "Redrob Candidate AI Discovery & Ranking Agent",
  description: "Advanced Recruiter AI system designed to rank and filter candidate profiles semantically beyond keyword matches.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
