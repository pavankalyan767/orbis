/** Centered message layer over the video stage: loading, building, ended, failed. */
export function StageOverlay({
  title,
  subtitle,
  imageUrl,
  spinner = false,
  children,
}: {
  title: string;
  subtitle?: string;
  imageUrl?: string | null;
  spinner?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="stage-overlay">
      {spinner && <div className="spinner" />}
      {imageUrl && (
        <img className="first-frame" src={imageUrl} alt="World first frame preview" />
      )}
      <div className="title">{title}</div>
      {subtitle && <div className="subtitle">{subtitle}</div>}
      {children && <div className="actions">{children}</div>}
    </div>
  );
}
