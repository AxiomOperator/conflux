from conflux.wiki.chunker import CHUNK_SIZE, Chunk, chunk_text


def test_chunk_text_returns_empty_for_blank_input() -> None:
    assert chunk_text('   ', 'page-id', 'Title') == []


def test_chunk_text_keeps_short_documents_in_one_chunk() -> None:
    chunks = chunk_text('Short wiki content.', 'page-id', 'Title')

    assert chunks == [
        Chunk(
            text='Short wiki content.',
            page_id='page-id',
            chunk_index=0,
            source_title='Title',
        )
    ]


def test_chunk_text_splits_long_documents_with_metadata() -> None:
    text = ' '.join(f'word{i}' for i in range(CHUNK_SIZE))

    chunks = chunk_text(text, 'page-id', 'Title')

    assert len(chunks) > 1
    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))
    assert all(chunk.page_id == 'page-id' for chunk in chunks)
    assert all(chunk.source_title == 'Title' for chunk in chunks)
    assert all(chunk.text for chunk in chunks)
