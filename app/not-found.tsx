import Link from "next/link";
export default function NotFound(){
 return <div className="interior-page"><p className="eyebrow dark">NOT FOUND</p><h1>This record<br/><em>is not here.</em></h1>
  <p className="interior-lead">The page or record you asked for does not exist, or it has not been published. Published contributions are never deleted; a restricted item still shows its public notice.</p>
  <p><Link href="/debates" className="inline-arrow">Browse published debates ↗</Link></p>
  <p><Link href="/" className="inline-arrow">Return to the home page ↗</Link></p></div>;
}
