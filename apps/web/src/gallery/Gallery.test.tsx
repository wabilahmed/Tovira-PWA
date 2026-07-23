import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Gallery, type ImagesApi } from './Gallery.js';
import type { ImageRecord } from './imagesClient.js';

const img = (id: string): ImageRecord => ({ id, clientId: 'c1', contentType: 'image/png', createdAt: 1 });

function makeApi(images: ImageRecord[], over: Partial<ImagesApi> = {}): ImagesApi {
  return {
    list: vi.fn().mockResolvedValue(images),
    upload: vi.fn().mockResolvedValue(img('new')),
    url: (id: string) => `/images/${id}`,
    ...over,
  };
}

describe('<Gallery>', () => {
  it('renders the client\'s photos with their bytes URLs', async () => {
    render(<Gallery clientId="c1" api={makeApi([img('i1'), img('i2')])} />);
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
    expect(screen.getAllByRole('img')[0]).toHaveAttribute('src', '/images/i1');
  });

  it('shows an empty state with no photos', async () => {
    render(<Gallery clientId="c1" api={makeApi([])} />);
    expect(await screen.findByText(/no photos yet/i)).toBeInTheDocument();
  });

  // POSITIVE: uploading a photo calls the API and reloads.
  it('uploads a photo and reloads the gallery', async () => {
    const user = userEvent.setup();
    const api = makeApi([]);
    render(<Gallery clientId="c1" api={api} />);
    await screen.findByText(/no photos yet/i);
    await user.upload(screen.getByLabelText(/add a photo/i), new File(['x'], 'p.png', { type: 'image/png' }));
    await waitFor(() => expect(api.upload).toHaveBeenCalled());
    expect((api.list as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1);
  });

  // NEGATIVE: a failed upload shows an error.
  it('shows an error when upload fails', async () => {
    const user = userEvent.setup();
    render(<Gallery clientId="c1" api={makeApi([], { upload: vi.fn().mockResolvedValue(null) })} />);
    await screen.findByText(/no photos yet/i);
    await user.upload(screen.getByLabelText(/add a photo/i), new File(['x'], 'p.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
