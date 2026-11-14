"""Durable, county-scoped chat state; only validated, completed turns are committed."""

import json
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import delete, insert, select, update

from app.models import chat_conversations


def create_conversation(conn, area_code, history=None):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    conversation = {
        "id": str(uuid4()),
        "area_code": area_code,
        "created_at": now,
        "updated_at": now,
        "version": 0,
        "history": history or [],
        "turns": [],
    }
    conn.execute(insert(chat_conversations).values(**conversation))
    conn.commit()
    return conversation


def get_conversation(conn, area_code, conversation_id):
    row = (
        conn.execute(
            select(chat_conversations).where(
                chat_conversations.c.id == str(conversation_id),
                chat_conversations.c.area_code == area_code,
            )
        )
        .mappings()
        .first()
    )
    if row is None:
        raise HTTPException(404, "Conversation not found for this county")
    return dict(row)


def conversation_history(conversation):
    history = list(conversation["history"])
    for turn in conversation["turns"][-6:]:
        history.extend(
            [
                {"role": "user", "content": turn["question"]},
                {"role": "assistant", "content": json.dumps(turn["response"]["answer"])[:8000]},
            ]
        )
    return history[-12:]


def save_turn(conn, conversation, question, response):
    version = conversation["version"]
    result = conn.execute(
        update(chat_conversations)
        .where(
            chat_conversations.c.id == conversation["id"],
            chat_conversations.c.version == version,
        )
        .values(
            turns=[*conversation["turns"], {"question": question, "response": response}],
            version=version + 1,
            updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
        )
    )
    if result.rowcount != 1:
        conn.rollback()
        raise HTTPException(409, "Conversation changed; reopen it before sending again")
    conn.commit()
    return {**response, "conversation_id": conversation["id"], "version": version + 1}


def clear_conversation(conn, area_code, conversation_id):
    get_conversation(conn, area_code, conversation_id)
    conn.execute(delete(chat_conversations).where(chat_conversations.c.id == str(conversation_id)))
    conn.commit()
